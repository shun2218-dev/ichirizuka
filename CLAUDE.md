# CLAUDE.md

一里塚 / ichirizuka — 走った記録を積み上げて残りを見るための個人用ダッシュボード。

Google スプレッドシートを唯一のデータソースとする Next.js（App Router）アプリ。DB もチャートライブラリも使わない。

## 作業を始める前に

作業内容に応じて、以下のドキュメントを読んでから着手すること。

| ドキュメント | 読むタイミング |
| --- | --- |
| @docs/development-rules.md | ブランチを切る前、PR を作る前、Issue を立てるとき |
| @docs/coding-rules.md | コードに触れるとき |
| @docs/specification.md | 集計ロジック・画面・データソースを変えるとき |
| @docs/design.md | CSS・色・グラフ・レイアウトに触れるとき |
| @docs/roadmap.md | 新しい提案をするとき、方針を確認するとき |

## 特に守ること

抜粋。詳細は上記の各ドキュメントを参照。

### ブランチと PR

- トピックブランチは **必ず `develop` から切る**。`main` から切らない
- PR のベースは **常に `develop`**。`gh pr create --base develop` と明示する
- `main` / `develop` へ直接 push しない

### Issue

- 大きい機能追加・バグ修正・将来対応が必要な事項は Issue を立てて PR と関連付ける
- トピック PR で **`Closes #N`** を使う。`develop` がデフォルトブランチなのでマージ時に自動クローズされる
- 閉じずに参照だけしたい場合は `Refs #N`
- 閉じている Issue = **対応済み**（リリース済みとは限らない）。リリース PR では Issue のクローズを扱わない

### リリース

- `develop` → `main` の PR は **merge commit**（squash しない）。トピック PR だけ squash
- `package.json` の `version` を上げてから `develop` に載せる。`main` へ直接 push しない
- タグは `gh release create v0.2.0 --target main`。リリースノートは日本語で書く
- 新しい環境変数が要る変更は、**未設定でも落ちない作り**にする

### コード

- **アプリの依存を増やさない。** `dependencies` は `next` / `react` / `react-dom` のみ。`scripts/` のオフライン道具は例外（判断基準は @docs/coding-rules.md）
- デフォルトはサーバーコンポーネント。`"use client"` は本当に必要なときだけ
- `lib/` は React に依存しない純粋関数のみ
- コメントは「なぜそうしているか」を書く。外部データの揺れへの対処には必ず理由を残す
- 色・フォント・余白は `:root` の CSS 変数経由で参照する。生の色値を直接書かない

### 秘匿情報

- `.env.example` に実際の値を書かない。**必ずダミー値にする**
- `SHEET_ID` は閲覧可能なシートを指すため、実質的にアクセス権に相当する

## 変更前に通すもの

```bash
npm run build
```

型チェックを含む。これが通らない変更はコミットしない。テストは未導入。

## ディレクトリ

```
app/page.tsx             画面の組み立て（サーバーコンポーネント）
app/api/refresh/route.ts キャッシュ破棄
lib/sheet.ts             CSV 取得とパース（表記ゆれの吸収）。Running / Daily の両タブ
lib/metrics.ts           週/月の集計、ベスト、負荷、日次指標の計算
lib/format.ts            ペース・時間・色の整形
components/              SVG グラフ、ボタン
app/globals.css          見た目のすべて
apps-script/             Google Apps Script（アプリ本体とは独立）
docs/                    開発ドキュメント
```
