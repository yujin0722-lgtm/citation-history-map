# CLAUDE.md

## GitHub書き込み権限のトラブルシューティング（2026年7月に発生・解決済み）

もし `git push` やGitHub API経由のコミット・ブランチ作成が
`403 Resource not accessible by integration` で失敗する場合、原因はほぼ確実に
**claude.aiアカウントにGitHub App「Claude」（Owned by anthropics）がインストールされていない**こと。

### 症状の見分け方
- 読み取り（`get_me`、ファイル取得、ブランチ一覧）は正常に動作する
- 書き込み（`git/refs`の作成、`git/trees`の作成）だけが`403`になる
- `https://github.com/settings/installations`（Installed GitHub Apps）が空、または対象アカウントに「Claude」がない
- `https://github.com/settings/apps/authorizations`（Authorized GitHub Apps）には「Claude」が「Never used」で存在する
  → これは「本人認可（Authorization）はあるが、リポジトリへのインストール（Installation）がない」状態を意味する

### 誤解しやすい点
- claude.ai設定 → コネクタ → GitHub連携の「切断」→「再接続」は、**本人確認のOAuth画面が出るだけ**で、GitHub App本体のインストール画面には遷移しない（本来はここで自動的にインストール画面まで誘導されるべきだが、そうならないことがある＝claude.ai側の連携フローの不具合と思われる）
- GitHub Marketplaceで「claude」を検索しても、このApp（`github.com/apps/claude`）はヒットしない（Marketplaceに公開登録されていない非公開Appのため）。検索結果に出る「Claude Code Base Action」「Claude Code Action Official」は**無関係**（GitHub Actions用の別機能で、PR/Issueでの`@claude`メンションに反応するもの。インストールしても今回の問題は解決しない）

### 解決方法
1. `https://github.com/apps/claude` に直接アクセス
2. 「Install」をクリック
3. インストール先アカウントを選択
4. リポジトリアクセスを設定（All repositories、または対象リポジトリを個別選択）
5. `https://github.com/settings/installations` に「Claude」が表示され、書き込み権限（Contents: Read and write）が付与される

### 参考
この情報は2026年7月23日、Anthropicサポートとのやり取りで判明した。同じ問題が別のリポジトリ・別アカウントで再発した場合も、同じ手順で解決できるはず。
