# 一里塚 / ichirizuka

街道の一里塚のように、走った分を積み上げて残りを見るための個人用ダッシュボード。
Google スプレッドシートの「Running」タブ（HealthFit が書き込んでいる記録）を読んで、
走行距離・ペース・負荷をまとめます。
Next.js 16（App Router）だけで動きます。DB もチャートライブラリも使っていません。

- 週の距離と目標の進捗
- 直近52週のストリップ（棒の高さ = 距離、色 = 平均心拍）
- 直近7日 ÷ 直近28日の週平均（走行量を急に増やしていないかの目安）
- コンディション（安静時心拍数・HRV・VO2max・体重・歩数）と走行量の並べ見
- 距離とペースの散布図（直近180日）
- 距離帯ごとのベスト / 月別 / 1本ずつの記録

## 1. シートを読める状態にする

このアプリはシートを **CSV として取得**します。次のどちらかが必要です。

**A. リンク共有（かんたん・おすすめ）**
シートの「共有」→「リンクを知っている全員」→ **閲覧者** にする。
これだけで次の URL が CSV を返すようになります（アプリが自動で組み立てます）。

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&gid=<SHEET_GID>
```

**B. ウェブに公開**
「ファイル」→「共有」→「ウェブに公開」で Running タブを CSV 形式で公開し、
表示された URL を `SHEET_CSV_URL` に入れる。

どちらも URL を知っている人は中身を読めます。気になる場合は、
Running タブだけを `IMPORTRANGE` で別シートにコピーして、そちらを共有してください。

## 2. ローカルで動かす

```bash
cp .env.example .env.local   # SHEET_ID と SHEET_GID を自分のものに
npm install
npm run dev                  # http://localhost:3000
```

環境変数:

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `SHEET_ID` | ○ | シート URL の `/d/` と `/edit` の間 |
| `SHEET_GID` | ○ | Running タブの `#gid=` の数字 |
| `SHEET_CSV_URL` | – | 指定するとこの URL を直接読む（上の2つは無視） |
| `SHEET_DAILY_GID` | – | Daily タブの `#gid=` の数字。入れるとコンディションが出る |
| `SHEET_DAILY_CSV_URL` | – | Daily タブの CSV URL を直接指定する |
| `WEEKLY_TARGET_KM` | – | 週の目標距離。既定 30 |
| `APP_TIMEZONE` | – | 既定 `Asia/Tokyo` |

安静時心拍数・HRV・VO2max・体重・歩数は、iPhone のショートカットから同じシートの
`Daily` タブに毎日未明、前日までの分を投げます。作り方は
[docs/daily-metrics-setup.md](docs/daily-metrics-setup.md)。
`SHEET_DAILY_GID` を入れなければコンディションのセクションは出ず、走りの記録だけが表示されます。

## 3. Vercel にデプロイ

GitHub に push して Vercel で Import します。
Vercel の Project → Settings → Environment Variables に上の変数を入れるだけです。
ビルド設定は初期値のまま（Framework: Next.js）。

自分だけが見たい場合は、Vercel の **Deployment Protection → Vercel Authentication** を
有効にすると、自分の Vercel アカウントでログインしないと開けなくなります。

## 4. 更新のしかた

ページは10分キャッシュします。走った直後に見たいときは右上の「シートを読み直す」を押すと、
`/api/refresh` がキャッシュを捨てて読み直します（シート側の反映ラグはそのままです）。

## 構成

```
app/page.tsx            画面の組み立て（サーバーコンポーネント）
app/api/refresh/route.ts キャッシュ破棄
lib/sheet.ts            CSV 取得とパース（時間の表記ゆれを吸収）
lib/metrics.ts          週/月の集計、ベスト、負荷、日次指標の計算
lib/format.ts           ペース・時間・色の整形
components/YearStrip.tsx 52週ストリップ（SVG）
components/PaceScatter.tsx 距離×ペース（SVG）
components/ConditionChart.tsx 安静時心拍数×走行距離（SVG）
app/globals.css         見た目のすべて
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/development-rules.md](docs/development-rules.md) | ブランチ・Issue・PR・リリースの運用 |
| [docs/coding-rules.md](docs/coding-rules.md) | TypeScript / React / CSS の方針 |
| [docs/specification.md](docs/specification.md) | データソース、集計ロジック、画面仕様 |
| [docs/design.md](docs/design.md) | カラー、タイポグラフィ、レイアウト、グラフ |
| [docs/roadmap.md](docs/roadmap.md) | 開発計画と検討中の項目 |
| [docs/daily-metrics-setup.md](docs/daily-metrics-setup.md) | 日次のヘルスケア数値をシートに足す手順 |

AI 支援ツール向けのエントリポイントは [CLAUDE.md](CLAUDE.md) です。

## 気をつけている点

- **時間の表記ゆれ**: `0h:44m:44s` / `0:44:44` / `44:44` / 秒数 / シリアル値のどれでも読めます。
- **距離の単位**: データ全体の中央値で m / km を判定します（147m の記録を 147km と誤読しない）。
- **誤タップ**: 0.4km 未満の記録は集計から外し、件数だけ脚注に出します。
- **タイムゾーン**: シートの時刻は Asia/Tokyo の壁時計として扱い、サーバー（UTC）と混ざらないようにしています。
