# nail の作業ルール

## Cloudflare: cf と Vite を使う

- このプロジェクトは `cf` CLI を使う方針。Cloudflare の操作・ビルド・デプロイは `cf` を使う。
- Worker の設定は `cloudflare.config.ts`、ビルド設定は `vite.config.ts` に置く。Cloudflare Vite プラグインの cf 対応版を使う。
- Wrangler を依存に追加しない。`wrangler.config.ts`、`wrangler.jsonc`、`wrangler.toml`、`wrangler.live.jsonc` などの設定を作らない。
- **コマンドの入口だけ `cf` に変えて、内部で Wrangler に委譲する構成も不可。** `cf migrate` の既定値は Wrangler を選ぶ場合があるため、そのまま採用しない。
- 構成変更後は `cf build` が Vite に委譲していることと、`npm ls wrangler` に依存がないことを確認する。
- CLI の仕様は公式ドキュメントとインストール済みのヘルプで確認する。コマンド探索には `cf cli search` を使い、検索語にアカウント情報やドメインなどを含めない。
- cf で対応できない問題が起きても、独断で Wrangler に戻さない。まず cf / Vite で解決し、方針変更が必要なら理由を説明してユーザーに確認する。

### このルールの背景

2026-10-01、既存の Wrangler 設定をもとに、入口だけを `cf deploy` に切り替える対応をしてしまった。ユーザーの意図は cf と Vite の構成であり、Wrangler の設定・依存を残す対応ではなかった。この取り違えを繰り返さない。

## ビルドとデプロイ

- `npm run build:live`: cf / Vite で画面と Worker をビルドし、生成型を含めて型チェックする。
- `npm run deploy:live`: 上記ビルドの後、`cf deploy --prebuilt` で公開する。
- 本番はローカル設定 `.local/deploy.json` で指定する Worker `nail`。既存の D1 バインディング、認証、Secrets を維持する。スキーマは `migrations/` で管理する。
- デプロイ後は公開ページの配信と、未認証のメール API が拒否されることを確認する。
- ユーザーがデプロイを指示した場合は、その範囲の作業について再確認を挟まず進める。

## ローカル開発と確認

- Node.js 26、npm と既存の `package-lock.json` を使う。
- `npm run dev` はローカル Hono API と画面を起動する。Vite の `standalone` モードはこのローカル API 用で、Cloudflare プラグインを有効にしない。
- `npm run build` でローカル版の型チェック・画面ビルド、`npm test` で既存テストを実行する。変更に応じて必要な確認を行う。
- 認証情報、メールデータ、Secrets をソースやログに書かない。

## 画面

- メール一覧は各項目を最大2行に保つ。1行目は送信者・日時、2行目は件名・分類。長い文字列は省略する。
- プロモーションの送信元一覧も最大2行に保つ。
