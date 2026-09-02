/**
 * 週の頭に「今週のメニュー」を取りに行って、自分に送る。
 *
 * ダッシュボードを開かないとメニューが出てこない状態だと、週の頭に何を走るかが
 * 手元に来ない。メニューの生成はアプリの中にしか無い（VDOT もペースも lib/）ので、
 * **ここは取って配るだけ**にする。取得先は /api/plan。
 *
 * 置き場所: daily-metrics.gs と同じ Apps Script プロジェクトでよい。
 *           doPost とは別の関数なので衝突しない。
 * 設定:     プロジェクトの設定 → スクリプト プロパティ
 *             PLAN_URL     https://<デプロイ先>/api/plan  （必須）
 *             PLAN_MAIL_TO 送り先。省略するとスクリプトの実行者宛て
 *             APP_URL      メールの末尾に付けるダッシュボードの URL（任意）
 *             PLAN_BASIC_USER / PLAN_BASIC_PASSWORD
 *                          アプリに Basic 認証を掛けている場合だけ（任意）
 *           タイムゾーンを Asia/Tokyo にしておくこと（月曜の判定がずれる）。
 * トリガー: createWeeklyPlanTrigger() をエディタから 1 回実行する。
 *
 * 使い方は docs/weekly-plan-delivery.md を参照。
 */

/** 何時台に送るか。走る前に読めるよう朝に置く */
const PLAN_HOUR = 6;

function sendWeeklyPlan() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("PLAN_URL");
  if (!url) {
    throw new Error("スクリプトプロパティ PLAN_URL が未設定です");
  }

  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: basicAuthHeaders(props),
  });
  const code = res.getResponseCode();
  const text = res.getContentText();

  // 失敗は握りつぶさない。投げておけば Apps Script が実行失敗を知らせてくれる
  if (code !== 200) {
    throw new Error("メニューを取得できません: HTTP " + code + " / " + text.slice(0, 300));
  }

  const body = JSON.parse(text);
  if (!body.ok) {
    throw new Error("メニューを取得できません: " + body.error);
  }

  const appUrl = props.getProperty("APP_URL");
  const to = props.getProperty("PLAN_MAIL_TO") || Session.getEffectiveUser().getEmail();

  MailApp.sendEmail({
    to: to,
    subject: "今週のメニュー（" + body.weekLabel + "）",
    body: body.text + (appUrl ? "\n\n" + appUrl : ""),
  });
}

/**
 * アプリに Basic 認証が掛かっているときの Authorization ヘッダー。
 *
 * 掛けていなければ何も付けない（空のまま渡してよい）。片方だけ入っている状態は
 * 設定の途中とみなして付けない — 中途半端なヘッダーを送っても 401 になるだけ。
 */
function basicAuthHeaders(props) {
  const user = props.getProperty("PLAN_BASIC_USER");
  const password = props.getProperty("PLAN_BASIC_PASSWORD");
  if (!user || !password) return {};

  // UTF_8 を明示する。既定の charset だと非 ASCII のパスワードが化ける
  const token = Utilities.base64Encode(user + ":" + password, Utilities.Charset.UTF_8);
  return { Authorization: "Basic " + token };
}

/**
 * 毎週月曜の朝に sendWeeklyPlan を動かす。
 *
 * 何度実行しても増えないよう、同じ関数のトリガーがあれば作らない
 * （トリガーの二重登録はメールの二重送信になる）。
 */
function createWeeklyPlanTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "sendWeeklyPlan";
  });
  if (exists) {
    Logger.log("すでに登録済みです");
    return;
  }

  ScriptApp.newTrigger("sendWeeklyPlan")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(PLAN_HOUR)
    .create();
  Logger.log("毎週月曜 " + PLAN_HOUR + " 時台に送るよう登録しました");
}
