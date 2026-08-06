#!/usr/bin/env node
/**
 * iPhone のショートカット（.shortcut）を組み立てる。
 *
 * 41 アクションを手で並べるのは現実的でないので、plist を直接書く。
 * ショートカットのアクション識別子は非公開なので、手で作った実物から読んで写している。
 * 構造を変えたくなったら、ショートカット.app で 1 ブロックだけ作って iCloud リンクで
 * 共有し、`https://www.icloud.com/shortcuts/api/records/<id>` の `fields.shortcut` を
 * 落とすと、署名なしの plist がそのまま読める。
 *
 * 使い方（macOS のみ。plutil と shortcuts コマンドを使う）:
 *   node scripts/build-shortcuts.mjs
 *
 * 出力は shortcuts/ に 2 種類ずつ。
 *   *.plist    署名なし。人が読める形。差分を見るのはこちら
 *   *.shortcut 署名済み。iPhone / Mac に取り込むのはこちら（gitignore 済み）
 *
 * トークンとウェブアプリの URL はプレースホルダのまま出力する。**実際の値を書いた
 * ショートカットをこのディレクトリに置かないこと。** トークンはシートへの書き込み権限
 * そのものなので、コミットすると漏れる。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ファイル名に日本語が入るので、URL のまま渡すとパーセントエンコードされてしまう
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "shortcuts");

/** 置換用の目印。取り込んだあと、ショートカット.app で書き換えてもらう */
const TOKEN_PLACEHOLDER = "PASTE_NEW_TOKEN_HERE";
const URL_PLACEHOLDER = "https://script.google.com/macros/s/PASTE_WEBAPP_URL_HERE/exec";

/** Daily タブの列に対応する 5 指標。type はショートカットの「種類」に出る英語表記 */
const METRICS = [
  { type: "Resting Heart Rate", metric: "resting_hr" },
  { type: "Heart Rate Variability", metric: "hrv" },
  { type: "VO2 Max", metric: "vo2max" },
  { type: "Weight", metric: "weight" },
  { type: "Steps", metric: "steps" },
];

/**
 * 変数の差し込み位置を表す文字（U+FFFC）。ショートカットは本文にこれを置き、
 * 何文字目に何を差し込むかを attachmentsByRange 側で持つ。
 */
const OBJ = "￼";

/** NSCalendarUnit の値。日付フィルタの Unit はこれで指定する */
const CALENDAR_UNIT_DAY = 16;

/** 直前までのアクションの出力を指す参照 */
const outputRef = (uuid, name) => ({
  Value: { OutputUUID: uuid, Type: "ActionOutput", OutputName: name },
  WFSerializationType: "WFTextTokenAttachment",
});

/**
 * 文字列と差し込みを混ぜて本文を作る。
 * parts の文字列はそのまま、オブジェクトは差し込み 1 個ぶんとして扱う。
 */
function tokenString(parts) {
  let string = "";
  const attachmentsByRange = {};
  for (const part of parts) {
    if (typeof part === "string") {
      string += part;
      continue;
    }
    attachmentsByRange[`{${string.length}, 1}`] = part;
    string += OBJ;
  }
  return {
    Value: { string, attachmentsByRange },
    WFSerializationType: "WFTextTokenString",
  };
}

/**
 * daysBack: シートに書く下限（今日から何日前まで）。0 なら from を送らない
 * windowDays: 検索する日数。daysBack より広く取る
 *
 * 検索を広めに取るのは、「開始日 が次の過去の期間内 N 日」が実行時刻を起点にした
 * 移動窓で、いちばん古い日が途中で切れるため。切れた日は from を見た Apps Script が
 * 捨てる。「が次の間」なら日の境目で切れるが、あの欄には変数を差し込めない。
 */
function buildWorkflow({ daysBack, windowDays }) {
  const actions = [];
  let seq = 0;
  // UUID は同じファイル内で一意なら何でもよい。差分を読みやすくするため連番にする
  const uuid = () =>
    `A0000000-0000-4000-8000-${String(++seq).padStart(12, "0").toUpperCase()}`;
  const push = (id, params) =>
    actions.push({ WFWorkflowActionIdentifier: id, WFWorkflowActionParameters: params });

  // トークンは 1 か所にまとめる。5 指標ぶん書き換えるのは事故のもと
  const tokenUuid = uuid();
  push("is.workflow.actions.gettext", {
    UUID: tokenUuid,
    WFTextActionText: TOKEN_PLACEHOLDER,
  });
  push("is.workflow.actions.setvariable", {
    WFVariableName: "token",
    WFInput: outputRef(tokenUuid, "テキスト"),
  });

  if (daysBack > 0) {
    const dateUuid = uuid();
    push("is.workflow.actions.date", { UUID: dateUuid, WFDateActionMode: "Current Date" });

    const adjustedUuid = uuid();
    push("is.workflow.actions.adjustdate", {
      UUID: adjustedUuid,
      WFAdjustOperation: "Subtract",
      WFDate: outputRef(dateUuid, "日付"),
      WFDuration: {
        Value: { Magnitude: daysBack, Unit: "days" },
        WFSerializationType: "WFQuantityFieldValue",
      },
    });

    const formattedUuid = uuid();
    push("is.workflow.actions.format.date", {
      UUID: formattedUuid,
      WFDate: outputRef(adjustedUuid, "調整された日付"),
      WFDateFormatStyle: "Custom",
      WFDateFormat: "yyyy/MM/dd",
    });

    push("is.workflow.actions.setvariable", {
      WFVariableName: "from",
      WFInput: outputRef(formattedUuid, "書式設定された日付"),
    });
  }

  for (const { type, metric } of METRICS) {
    const findUuid = uuid();
    push("is.workflow.actions.filter.health.quantity", {
      UUID: findUuid,
      // 全指標を日でまとめる。1 日 1 件に畳まれるので繰り返しが日数ぶんで済み、
      // 「N 個のヘルスケア項目を共有しようとしています」の上限にも当たりにくい
      WFHKSampleFilteringGroupBy: "Day",
      WFContentItemLimitEnabled: false,
      WFContentItemSortProperty: "Start Date",
      WFContentItemSortOrder: "Latest First",
      WFContentItemFilter: {
        Value: {
          WFActionParameterFilterPrefix: 1,
          WFContentPredicateBoundedDate: false,
          WFActionParameterFilterTemplates: [
            {
              Property: "Type",
              Operator: 4,
              Removable: false,
              Bounded: true,
              Values: {
                Enumeration: { Value: type, WFSerializationType: "WFStringSubstitutableState" },
              },
            },
            {
              Property: "Start Date",
              Operator: 1001,
              Removable: false,
              Bounded: true,
              Values: { Unit: CALENDAR_UNIT_DAY, Number: String(windowDays) },
            },
          ],
        },
        WFSerializationType: "WFContentPredicateTableTemplate",
      },
    });

    // 「日付,値」を 1 行ずつ作る。日付を持たせるのは、実行時刻ではなくサンプル自身の
    // 日付で行を決めるため
    const group = uuid();
    push("is.workflow.actions.repeat.each", {
      WFControlFlowMode: 0,
      GroupingIdentifier: group,
      WFInput: outputRef(findUuid, "ヘルスケアサンプル"),
    });
    push("is.workflow.actions.gettext", {
      UUID: uuid(),
      WFTextActionText: tokenString([
        {
          VariableName: "Repeat Item",
          Type: "Variable",
          Aggrandizements: [
            { Type: "WFPropertyVariableAggrandizement", PropertyName: "Start Date" },
            {
              Type: "WFDateFormatVariableAggrandizement",
              WFDateFormatStyle: "Custom",
              WFDateFormat: "yyyy/MM/dd",
              WFISO8601IncludeTime: false,
            },
          ],
        },
        ",",
        { VariableName: "Repeat Item", Type: "Variable" },
      ]),
    });
    const repeatEndUuid = uuid();
    push("is.workflow.actions.repeat.each", {
      UUID: repeatEndUuid,
      WFControlFlowMode: 2,
      GroupingIdentifier: group,
    });

    // JSON の文字列に生の改行は入れられないので `;` で繋ぐ
    const joinedUuid = uuid();
    push("is.workflow.actions.text.combine", {
      UUID: joinedUuid,
      WFTextSeparator: "Custom",
      WFTextCustomSeparator: ";",
      text: outputRef(repeatEndUuid, "繰り返しの結果"),
    });

    const bodyUuid = uuid();
    push("is.workflow.actions.gettext", {
      UUID: bodyUuid,
      WFTextActionText: tokenString([
        '{"token":"',
        { VariableName: "token", Type: "Variable" },
        `","metric":"${metric}",`,
        ...(daysBack > 0 ? ['"from":"', { VariableName: "from", Type: "Variable" }, '",'] : []),
        '"rows":"',
        { OutputUUID: joinedUuid, Type: "ActionOutput", OutputName: "結合済みのテキスト" },
        '"}',
      ]),
    });

    push("is.workflow.actions.downloadurl", {
      UUID: uuid(),
      WFURL: URL_PLACEHOLDER,
      WFHTTPMethod: "POST",
      WFHTTPBodyType: "File",
      WFRequestVariable: outputRef(bodyUuid, "テキスト"),
    });
  }

  return {
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4292093695, WFWorkflowIconGlyphNumber: 61440 },
    WFWorkflowClientVersion: "3100.0.2.4",
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowActions: actions,
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: false,
  };
}

const TARGETS = [
  {
    name: "Ichirizuka日次記録",
    // 検索は 1 日広く取る。書くのは 4 日ぶん
    options: { daysBack: 4, windowDays: 5 },
  },
  {
    name: "Ichirizuka過去分の取り込み",
    // from を送らないので、当日以外はそのまま書く。1 年分は iOS の件数制限に当たるため
    // 30 日ずつに刻む前提。それより長い期間は import-health-export.mjs を使う
    options: { daysBack: 0, windowDays: 30 },
  },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, options } of TARGETS) {
  const json = join(OUT_DIR, `${name}.json`);
  const plist = join(OUT_DIR, `${name}.plist`);
  // shortcuts sign は入力の拡張子が .shortcut でないと「正しい形式ではありません」で落ちる
  const unsigned = join(OUT_DIR, `${name}.unsigned.shortcut`);
  const signed = join(OUT_DIR, `${name}.shortcut`);

  const workflow = buildWorkflow(options);
  writeFileSync(json, JSON.stringify(workflow));

  // 読む用（差分が見えるように XML）と、署名に渡す用（バイナリ）の 2 つに変換する
  execFileSync("plutil", ["-convert", "xml1", json, "-o", plist]);
  execFileSync("plutil", ["-convert", "binary1", json, "-o", unsigned]);
  rmSync(json);

  try {
    // --mode anyone で署名しておくと、取り込むときに「信頼されていないショートカットを
    // 許可」を有効にせずに済む
    execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", signed], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    rmSync(unsigned);
    console.log(`${name}: ${workflow.WFWorkflowActions.length} アクション → .plist / .shortcut`);
  } catch {
    console.log(`${name}: ${workflow.WFWorkflowActions.length} アクション → .plist のみ（署名に失敗）`);
    console.log("  署名は macOS の shortcuts コマンドが要ります。手動なら:");
    console.log(`  shortcuts sign --mode anyone --input "${unsigned}" --output "${signed}"`);
  }
}
