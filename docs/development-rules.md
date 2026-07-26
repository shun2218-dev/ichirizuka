# 開発ルール

このリポジトリでの進め方。ブランチ・Issue・PR・リリースの運用を定める。

## ブランチ運用

git-flow に準じる。

| ブランチ | 役割 | 派生元 | マージ先 |
| --- | --- | --- | --- |
| `main` | 本番リリース済みの状態 | — | — |
| `develop` | 開発の統合先。**デフォルトブランチ** | `main` | `main` |
| `feat/*` | 機能追加 | `develop` | `develop` |
| `fix/*` | バグ修正 | `develop` | `develop` |
| `chore/*` | 依存更新・設定・雑務 | `develop` | `develop` |
| `docs/*` | ドキュメントのみの変更 | `develop` | `develop` |
| `refactor/*` | 挙動を変えない内部改善 | `develop` | `develop` |

**トピックブランチは必ず `develop` から切る。** `main` から切らない。

```bash
git checkout develop && git pull
git checkout -b feat/weekly-target-editor develop
```

`main` へ直接 push しない。`develop` へも直接 push せず、必ず PR を経由する。

## Issue 運用

次のいずれかに当てはまるものは Issue を立てる。

- 大きい機能追加
- バグ修正
- すぐには対応しないが、今後対応が必要なもの（技術的負債、上流待ちの脆弱性など）

逆に、typo 修正や軽微な文言調整のように 1 PR で完結して記録に残す価値が薄いものは Issue 不要。

Issue には目的・背景・完了条件を書く。将来対応のものは「なぜ今やらないか」を残す。

## PR 運用

### ベースブランチ

トピック PR のベースは常に `develop`。

```bash
gh pr create --base develop --title "feat: 週の目標距離を UI から変更できるようにする"
```

### Issue との関連付け

**トピック PR では `Refs #N` を使う。`Closes` は使わない。**

`develop` がデフォルトブランチであるため、トピック PR に `Closes #N` を書くと `develop` へのマージ時点で Issue が自動クローズされてしまう。Issue は「リリースされて初めて完了」とみなすので、この時点では閉じない。

```markdown
Refs #2
```

### リリース PR

`develop` → `main` の PR で `Closes #N` を書き、そのリリースに含まれる Issue をまとめてクローズする。

```markdown
## リリース内容

- 週の目標距離の UI 変更 (#12)
- ペース散布図のツールチップ追加 (#15)

Closes #12
Closes #15
```

> **注意:** GitHub がキーワードで Issue を自動クローズするのは、PR が**デフォルトブランチ**にマージされたときだけ。現在のデフォルトは `develop` なので、`main` へのリリース PR をマージしても Issue は自動クローズされない。リリース PR マージ後に手動でクローズすること。自動化したい場合はデフォルトブランチを `main` に戻す必要がある。

### マージ方法

トピック PR は **squash merge**。マージ後はブランチを削除する。

```bash
gh pr merge <N> --squash --delete-branch
```

squash merge はローカルブランチの履歴と繋がらないため、マージ後のローカル削除は `git branch -D` を使う。

リリース PR（`develop` → `main`）は **merge commit** を使い、`develop` の履歴を保持する。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に従う。

```
<type>(<scope>): <subject>

<body>
```

| type | 用途 |
| --- | --- |
| `feat` | 機能追加 |
| `fix` | バグ修正 |
| `chore` | 依存更新、設定変更、ビルド周り |
| `docs` | ドキュメント |
| `refactor` | 挙動を変えない内部改善 |
| `style` | フォーマットのみ |
| `test` | テスト |

subject は日本語で可。命令形にこだわらず、何をしたかが分かることを優先する。

破壊的変更を含む場合は body に `BREAKING CHANGE:` を書く。

## リリース手順

1. `develop` の内容で `npm run build` が通ることを確認
2. `develop` → `main` の PR を作成し、含まれる Issue に `Closes #N` を付ける
3. マージ
4. Issue が自動クローズされていなければ手動でクローズ（上記の注意を参照）
5. 必要に応じて `main` にタグを打つ

## 秘匿情報

- `.env.local` は絶対にコミットしない（`.gitignore` 済み）
- **`.env.example` に実際の値を書かない。** 必ずダミー値にする
  - `SHEET_ID` は「リンクを知っている全員が閲覧可」のシートを指すため、ID そのものがアクセス権に相当する
- 誤ってコミットした場合、force push だけでは GitHub 上に dangling commit として残り SHA 直指定で閲覧できてしまう。リポジトリの削除・再作成か GitHub Support への GC 依頼が必要
