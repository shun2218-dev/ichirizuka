# コーディングルール

このプロジェクトのコードを書くときの方針。既存コードがすでに従っているので、迷ったら周囲のコードに合わせる。

## 全体方針

**依存を増やさない。** DB もチャートライブラリも状態管理ライブラリも使っていない。グラフは SVG を直接書き、集計は素の TypeScript で行う。新しい依存を足す前に、標準機能で書けないかを検討する。

現在の依存は `next` / `react` / `react-dom` のみ（devDependencies は型と TypeScript のみ）。

## TypeScript

- `strict: true`。`any` は使わない
- 型は必要な場所に書く。関数の返り値型は、公開 API（`lib/` の export）には明示し、ローカル関数は推論に任せてよい
- 集計結果のように構造が大きい型は `ReturnType<typeof fn>` で導出する（例: `lib/metrics.ts` の `Overview`、`Bucket`）
- 型のみの import は `import type` を使う

```ts
import type { Run } from "./sheet";
```

## React / Next.js

- **App Router。デフォルトはサーバーコンポーネント。** `"use client"` はブラウザ API やイベントハンドラが必要なときだけ（現状 `RefreshButton.tsx` のみ）
- ページの表示ロジックは `app/page.tsx` に集約し、再利用可能な描画部品だけ `components/` に切り出す
- 小さな表示専用コンポーネントは、使う場所と同じファイル内に置いてよい（`app/page.tsx` の `RunTable` / `Wordmark` / `Setup`）
- データ取得はサーバー側の `fetch` で行い、Next のキャッシュタグを使う

```ts
fetch(url, { next: { revalidate: 600, tags: ["runs"] } });
```

- キャッシュ破棄は `app/api/refresh/route.ts` の `revalidateTag("runs", "max")`。Next 16 から第 2 引数のキャッシュプロファイルが必須

## ディレクトリの責務

| パス | 責務 |
| --- | --- |
| `app/` | ルーティング、ページの組み立て、API Route |
| `components/` | 再利用する描画部品（SVG グラフ、ボタン） |
| `lib/sheet.ts` | CSV の取得とパース。外部データの揺れをここで吸収する |
| `lib/metrics.ts` | 集計・統計。日付境界の計算もここ |
| `lib/format.ts` | 表示用の整形（ペース、時間、色）。ロジックを持たない |
| `apps-script/` | Google Apps Script（アプリ本体とは独立） |

**`lib/` は React に依存しない。** 純粋な関数だけを置く。

## 命名

- ファイル名: コンポーネントは PascalCase（`YearStrip.tsx`）、それ以外は camelCase / kebab-case（`metrics.ts`）
- 関数・変数: camelCase
- 定数: 意味のある単位を持つものは SCREAMING_SNAKE_CASE（`NOISE_KM`、`PB_TIERS`）
- 単位を名前に含める。`distance` ではなく `distanceKm`、秒なら `movingSec` のように曖昧さを消す

## コメント

**「何をしているか」ではなく「なぜそうしているか」を書く。** 特に外部データの揺れへの対処や、一見不自然に見える判断には必ず理由を残す。

既存コードの例:

```ts
/**
 * 距離の単位は行ごとに判定すると短い記録（147.5m など）を km と誤読するので、
 * データ全体の中央値で一度だけ決める。Apple Watch 由来ならメートル。
 */
```

```ts
// 1 未満なら「1 日 = 1」のシリアル値とみなす（4h 未満の運動はこれで正しい）
```

コメントは日本語。JSDoc 形式は公開関数に使う。

## 外部データの扱い

シートの内容は信用しない。次を前提に書く。

- 時間の表記は揺れる（`0h:44m:44s` / `0:44:44` / `44:44` / 秒数 / シリアル値）
- ヘッダー名も揺れる（英日混在、空白、大文字小文字）→ `indexOfHeader` で正規化して照合
- 欠損値がある → パースは例外を投げず 0 や `null` に落とす
- 誤操作による極端に短い記録が混ざる → `NOISE_KM` 未満は集計から除外

新しい列を読むときも同じ方針を守る。

## 日付とタイムゾーン

**シートの日時は Asia/Tokyo の壁時計としてそのまま扱う。** サーバーは UTC で動くため、「今」を取るときは `wallClockNow()` を使い、`new Date()` を直接比較に使わない。

週の起点は月曜 00:00（`startOfWeek`）。

## CSS

- `app/globals.css` 1 枚にすべて書く。CSS Modules も CSS-in-JS も使わない
- 色・フォント・余白は `:root` のカスタムプロパティ経由で参照する。生の色値をセレクタ内に直接書かない
- クラス名はセマンティックに（`.hero-figure`、`.target-fill`）。ユーティリティクラスは作らない
- 詳細は [デザイン](design.md) を参照

例外: 値が動的に決まるもの（バーの幅、心拍による色）はインラインスタイルでよい。

```tsx
<div className="target-fill" style={{ width: `${weekPct}%` }} />
```

## リント / フォーマット

ESLint は未導入。`next lint` は Next 16 で削除された。現状はフォーマッタも入れていないため、既存コードのスタイル（2 スペースインデント、ダブルクォート、セミコロンあり）に手で合わせる。

導入する場合は Issue を立ててから。

## 変更前に通すもの

```bash
npm run build
```

型チェックを含む。これが通らない変更はコミットしない。テストは未導入。
