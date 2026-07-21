# GitHub Pages 公開手順（コードを書かずにブラウザだけで完結）

所要時間の目安：15〜20分

## 事前確認（重要）

- アップロードするフォルダに **config.js が無いこと** を確認する
  （config.example.js はアップロードしてよい。config.jsを作っていた場合、
  中にAPIキーが入っているため絶対に公開してはいけない）
- 公開リポジトリは世界中から閲覧できる。含めるのはこのアプリのファイルのみにする

## 手順1：GitHubアカウント作成（未取得の場合）

1. https://github.com を開き「Sign up」
2. メールアドレス・パスワード・ユーザー名を登録
   （ユーザー名は公開URLの一部になる：https://ユーザー名.github.io/...）

## 手順2：リポジトリ作成

1. ログイン後、右上の「+」→「New repository」
2. Repository name：`citation-history-map`
3. 「Public」を選択（GitHub Pagesの無料利用にはPublicが必要）
4. 他の項目はそのままで「Create repository」

## 手順3：ファイルのアップロード

1. 作成直後の画面にある「uploading an existing file」リンクをクリック
2. パソコン上のフォルダを開き、**フォルダの中身**（index.html, style.css,
   app.js, api.js, graph.js, storage.js, config.example.js, README.md,
   .gitignore, docsフォルダ）をまとめてドラッグ＆ドロップ
   ※ フォルダごとではなく「中身」を入れる。index.htmlがリポジトリの
   最上位に来ることが重要
3. 下の「Commit changes」を押す

## 手順4：GitHub Pagesを有効化

1. リポジトリ上部の「Settings」タブ
2. 左メニューの「Pages」
3. 「Source」を「Deploy from a branch」にする
4. Branchを「main」、フォルダを「/ (root)」にして「Save」
5. 1〜2分待って同じページを再読み込みすると、公開URLが表示される
   例：https://ユーザー名.github.io/citation-history-map/

## 手順5：動作確認

1. 公開URLをスマホとPCの両方で開く
2. APIキーを設定し、論文を1本読み込んでみる
3. 問題なければ、URLを共有して利用開始

## 更新のしかた（今後、新しい版に差し替えるとき）

1. リポジトリの「Add file」→「Upload files」
2. 変更されたファイルをドラッグ＆ドロップ（同名ファイルは上書きされる）
3. 「Commit changes」→ 数分で公開ページに反映

## 動作確認済みの版に印を付ける（タグ）

1. リポジトリの「Releases」→「Create a new release」
2. 「Choose a tag」に `v0.7` のように入力して「Create new tag」
3. タイトルに版の説明を書いて「Publish release」
