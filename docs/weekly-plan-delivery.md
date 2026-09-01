# 週次メニューを週の頭に受け取る

「今週のメニュー」を **月曜に確定させ**、その内容を **毎週メールで届ける**ための設定。

## なぜこの形なのか

メニュー生成（[#22](https://github.com/shun2218-dev/ichirizuka/issues/22)）を入れた直後は、
次の 2 点で実用にならなかった。

- **週の途中で内容が動く。** 直近 28 日から見るたびに組み直していたため、水曜に 1 本走ると
  週の合計も本数もペースも変わっていた。提案が動くと従いようがない
- **見に行かないと出てこない。** ダッシュボードを開いた人にしか表示されない

前者はアプリ側で直した（入力を月曜 00:00 で切る。[lib/weekPlan.ts](../lib/weekPlan.ts)）。
後者がこのドキュメントの範囲で、**アプリからは配らない**。読み取り専用という前提を崩さず、
既に書き込み側を担っている Apps Script に取りに来てもらう。

```
Apps Script（毎週月曜 6時）─→ GET /api/plan ─→ メール
```

## 1. メニューの口を確認する

デプロイ先の `/api/plan` をブラウザで開く。次のような JSON が返れば動いている。

```json
{
  "ok": true,
  "weekStart": "2026-08-17",
  "weekLabel": "8/17 の週",
  "nextAt": "2026-08-24",
  "plan": { "phase": "build", "totalKm": 42, "workouts": [] },
  "text": "強化\nレースまで9週\n合計 42.0km・4本\n…"
}
```

`text` がメールにそのまま入る本文。**画面と同じ内容**で、週の途中に叩いても同じものを返す。

実力を推定できるラン（直近 180 日に 3km 以上）が無いときは `plan` が `null` になり、
`text` にその理由が入る。シートが読めないときだけ HTTP 503 を返す。

> **注意:** Vercel の Deployment Protection を有効にしていると、Apps Script からは 401 で
> 弾かれる。Protection Bypass のトークンを使うか、保護を外すこと。

## 2. Apps Script に置く

スプレッドシート → 拡張機能 → Apps Script を開き、
[apps-script/weekly-plan.gs](../apps-script/weekly-plan.gs) の中身を貼り付ける。
`daily-metrics.gs` と同じプロジェクトでよい（`doPost` とは別の関数なので衝突しない）。

**プロジェクトのタイムゾーンを `Asia/Tokyo` にする**（プロジェクトの設定 → タイムゾーン）。
月曜の朝という指定がずれる。

## 3. スクリプト プロパティを入れる

プロジェクトの設定 → スクリプト プロパティ。

| キー | 値 | 必須 |
| --- | --- | --- |
| `PLAN_URL` | `https://<デプロイ先>/api/plan` | ○ |
| `PLAN_MAIL_TO` | 送り先のアドレス。省略すると実行者自身 | |
| `APP_URL` | メール末尾に付けるダッシュボードの URL | |

## 4. トリガーを作る

エディタで `createWeeklyPlanTrigger` を選んで実行する。毎週月曜の 6 時台に
`sendWeeklyPlan` が動くようになる。初回は権限の確認が出る。

**何度実行してもトリガーは増えない**（同じ関数のものがあれば作らない）。二重登録すると
メールが 2 通来るため。

動作確認は `sendWeeklyPlan` を直接実行する。すぐに 1 通届く。

## 送り先を変えたいとき

メール以外にしたい場合は `MailApp.sendEmail(...)` を差し替える。本文は `body.text` の
1 つだけなので、Webhook に POST するだけで済む。

```js
UrlFetchApp.fetch(WEBHOOK_URL, {
  method: "post",
  contentType: "application/json",
  payload: JSON.stringify({ text: body.text }),
});
```

## 失敗したとき

`sendWeeklyPlan` は取得に失敗したら例外を投げる。Apps Script が実行失敗をメールで
知らせるので、**黙って止まることはない**。よくある原因は次の 2 つ。

- `PLAN_URL` の打ち間違い、または Deployment Protection による 401
- シートが読めていない（503 が返る。ダッシュボードも同時に落ちているはず）
