#!/usr/bin/env node
/**
 * HealthFit が書き出した FIT ファイルから、シートだけでは取れない指標を作り
 * 「Fit」タブへ流し込む。
 *
 * なぜ要るか。Running タブにあるのは「ラン全体の平均心拍」だけで、これでは
 * 強度の配分（8 割を楽に、2 割を強く）が測れない。10km を淡々と走った日と
 * 10km の中に 400m × 6 本を入れた日は平均心拍がほぼ同じになるためで、精度の
 * 問題ではなく区別する情報が無い。FIT には心拍ゾーンごとの滞在時間が計算済みで
 * 入っているので、それを取り出す。
 *
 *   HealthFit → 設定 → エクスポート先に Google Drive を指定（形式は FIT）
 *   → そのフォルダをローカルに落とすか同期して、このスクリプトに渡す
 *
 * 使い方:
 *   node scripts/import-fit.mjs <dir|file.fit>              # 集計して確認するだけ
 *   node scripts/import-fit.mjs <dir> --out ./tmp/fit.csv   # CSV に書き出す
 *   node scripts/import-fit.mjs <dir> --post                # Fit タブへ送る
 *
 * 送信先とトークンは `.env.local` に置く（コマンドに書くとシェルの履歴に残るため）。
 * import-health-export.mjs と同じ 2 つを使う。
 *
 *   SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
 *   SHEET_WEBAPP_TOKEN=Apps Script の TOKEN と同じ文字列
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Decoder, Stream } from "@garmin/fitsdk";

/** Fit タブの列。増やしたいときは末尾に足す（既存の列は動かさない） */
const COLUMNS = [
  { key: "start", label: "Start" },
  { key: "moving_sec", label: "Moving Sec" },
  { key: "distance_m", label: "Distance M" },
  { key: "avg_hr", label: "Avg HR" },
  { key: "max_hr", label: "Max HR" },
  // ゾーン 0 は「ゾーン 1 の下限より下」。HealthFit の画面には出ないが FIT には入っている
  { key: "zone0_sec", label: "Zone 0 Sec" },
  { key: "zone1_sec", label: "Zone 1 Sec" },
  { key: "zone2_sec", label: "Zone 2 Sec" },
  { key: "zone3_sec", label: "Zone 3 Sec" },
  { key: "zone4_sec", label: "Zone 4 Sec" },
  { key: "zone5_sec", label: "Zone 5 Sec" },
  // 境界は滅多に変わらないが、変わったときに過去と混ぜないよう 1 本ずつに持たせる
  { key: "zone_bounds", label: "Zone Bounds" },
  { key: "max_hr_setting", label: "Max HR Setting" },
  { key: "resting_hr", label: "Resting HR" },
  { key: "laps", label: "Laps" },
  { key: "lap_trigger", label: "Lap Trigger" },
  { key: "rpe", label: "RPE" },
  { key: "avg_cadence", label: "Avg Cadence" },
  { key: "source_file", label: "Source File" },
];

const TIME_ZONE = process.env.APP_TIMEZONE ?? "Asia/Tokyo";

/** 1 リクエストで送るワークアウト数。GAS の実行時間制限（6 分）に当てないため */
const BATCH = 50;

function readEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  const env = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function fitFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target)
    .filter((f) => f.toLowerCase().endsWith(".fit"))
    .sort()
    .map((f) => join(target, f));
}

/**
 * 開始日時は「HealthFit が付けたファイル名」を優先する。
 *
 * FIT の startTime は UTC なので、シートの壁時計（Asia/Tokyo）に直すには変換が要る。
 * 一方ファイル名は HealthFit が既にローカル時刻で書いているので、変換を挟まないぶん
 * ずれようがない。名前の形が変わったときのために UTC からの変換も残す。
 */
function startedAt(file, session) {
  const name = file.split("/").pop() ?? "";
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6]}`;

  const at = session?.startTime;
  if (!(at instanceof Date)) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(at)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const round = (v, digits = 0) =>
  typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(digits)) : "";

function summarize(file) {
  const buf = readFileSync(file);
  const stream = Stream.fromBuffer(buf);
  if (!Decoder.isFIT(stream)) return { file, error: "FIT ファイルではありません" };

  const decoder = new Decoder(stream);
  // CRC が合わなくても読める分は使う。同期の途中で切れたファイルが 1 本混ざった
  // だけで全体が止まるほうが困る。件数は呼び出し側で警告として出す。
  const { messages, errors } = decoder.read();

  const session = messages.sessionMesgs?.[0];
  if (!session) return { file, error: "session がありません" };

  const start = startedAt(file, session);
  if (!start) return { file, error: "開始日時が読めません" };

  // 心拍ゾーンはセッション単位のものだけ使う（ラップ単位のものも入りうる）
  const zone = (messages.timeInZoneMesgs ?? []).find((z) => z.referenceMesg === "session");
  const zoneSec = zone?.timeInHrZone ?? [];
  const laps = messages.lapMesgs ?? [];

  return {
    file,
    // CRC 不一致は捨てずに件数だけ持って出す。壊れ始めたときに気づけるように
    warning: errors.length ? errors.map(String).join(" / ") : null,
    row: {
      start,
      moving_sec: round(session.totalTimerTime),
      distance_m: round(session.totalDistance, 1),
      avg_hr: session.avgHeartRate ?? "",
      max_hr: session.maxHeartRate ?? "",
      zone0_sec: round(zoneSec[0], 1),
      zone1_sec: round(zoneSec[1], 1),
      zone2_sec: round(zoneSec[2], 1),
      zone3_sec: round(zoneSec[3], 1),
      zone4_sec: round(zoneSec[4], 1),
      zone5_sec: round(zoneSec[5], 1),
      zone_bounds: zone?.hrZoneHighBoundary?.join("/") ?? "",
      max_hr_setting: zone?.maxHeartRate ?? "",
      resting_hr: zone?.restingHeartRate ?? "",
      laps: laps.length,
      // 距離オートラップなら単なる km 刻み。構造化練習かどうかはここで見分ける
      lap_trigger: laps[0]?.lapTrigger ?? "",
      // FIT の workout_rpe は 10 倍。HealthFit の推定値なので自己申告とは別物
      rpe: typeof session.workoutRpe === "number" ? session.workoutRpe / 10 : "",
      avg_cadence: session.avgRunningCadence ?? session.avgCadence ?? "",
      source_file: file.split("/").pop(),
    },
  };
}

async function post(url, token, rows) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, fit: rows.slice(i, i + BATCH) }),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    if (!json.ok) throw new Error(json.error ?? "不明なエラー");
    added += json.added ?? 0;
    updated += json.updated ?? 0;
    skipped += json.skipped ?? 0;
  }

  return { added, updated, skipped };
}

function parseArgs(argv) {
  const args = { target: null, out: null, post: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--post") args.post = true;
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (!args.target) args.target = argv[i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target) {
  console.error("使い方: node scripts/import-fit.mjs <dir|file.fit> [--out file.csv] [--post]");
  process.exit(1);
}

const results = fitFiles(args.target).map(summarize);
const ok = results.filter((r) => r.row);
const failed = results.filter((r) => !r.row);

console.log(`FIT ${results.length} 本 / 読めた ${ok.length} 本\n`);
for (const r of failed) {
  console.error(`  読めず: ${r.file.split("/").pop()} — ${r.error}`);
}

// ゾーン滞在時間が入っていないと、この取り込みをやる意味そのものが無い。
// 静かに 0 が並ぶより、何本入っていないかを毎回出す。
const noZone = ok.filter((r) => r.row.zone_bounds === "");
if (noZone.length) {
  console.warn(`  ゾーン滞在時間なし: ${noZone.length} 本（time_in_zone が入っていない）`);
}
const warned = ok.filter((r) => r.warning);
if (warned.length) {
  console.warn(`  警告つき: ${warned.length} 本（${warned[0].warning}）`);
}

if (ok.length) {
  const first = ok[0].row;
  const last = ok[ok.length - 1].row;
  console.log(`\n  期間  ${first.start} 〜 ${last.start}`);
  console.log(
    `  最新  ${last.distance_m}m / ${last.moving_sec}秒 / 平均 ${last.avg_hr}bpm / ` +
      `ゾーン ${[0, 1, 2, 3, 4, 5].map((i) => last[`zone${i}_sec`]).join("-")}秒`,
  );
}

const rows = ok.map((r) => r.row);

if (args.out) {
  const head = COLUMNS.map((c) => c.label).join(",");
  const body = rows.map((row) => COLUMNS.map((c) => row[c.key]).join(","));
  writeFileSync(args.out, [head, ...body].join("\n"));
  console.log(`\n書き出し: ${args.out}`);
}

if (args.post) {
  const env = { ...readEnvLocal(), ...process.env };
  const url = env.SHEET_WEBAPP_URL;
  const token = env.SHEET_WEBAPP_TOKEN;
  if (!url || !token) {
    console.error(
      "\n.env.local に次の 2 行を足してください（Apps Script のデプロイ画面と TOKEN からコピー）:\n" +
        "  SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec\n" +
        "  SHEET_WEBAPP_TOKEN=...",
    );
    process.exit(1);
  }

  try {
    const r = await post(url, token, rows);
    console.log(`\n追加 ${r.added} / 更新 ${r.updated} / スキップ ${r.skipped}`);
  } catch (err) {
    console.error(`\n失敗: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
