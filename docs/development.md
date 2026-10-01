# 開発環境

## Cloudflare CLI

2026-09-29 に Cloudflare の新しい `cf` CLI 公開ベータ `1.0.0-beta.5` を、この Mac の npm グローバル環境へ導入した。`cf --version` と同梱の `workerd --version` の実行を確認済み。導入時は `cf auth login` で認証し、`cf auth whoami` でトークンが有効・接続先アカウントが 1 件であることを確認した。その後の設計検証時には `cf auth whoami` が `authenticated: false` を返した。Workers AI の実行前に再ログインが必要。

新しい CLI のため、コマンドの構文は記憶に頼らず `cf cli search "やりたい操作"` と対象コマンドの `--help` で確認する。プロジェクトの設定・デプロイ方法は実装時に決め、既存の設計だけを理由に `cf init` や `cf deploy` は実行しない。

参考: [Cloudflare のリリース記事](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)

## Cloudflare MCP

2026-09-29 に Codex へ次の MCP 接続を設定した。

| 接続名 | 用途 | 状態 |
| --- | --- | --- |
| `cloudflare` | Cloudflare API の Code Mode MCP | Cloudflare プラグインから登録。OAuth ログイン成功。ユーザー情報・アカウント情報・Workers スクリプトの読み取り権限に限定。 |
| `cloudflare_docs` | Cloudflare 公式ドキュメントの検索 | Codex に追加。MCP 初期化応答を確認済み。 |

`cf auth login` と MCP の OAuth は別の認証。MCP に書き込み権限が必要になったときは、実行したい操作を決めてから必要な権限だけを追加する。新しい Codex 会話では MCP ツールが利用可能か確認する。

参考: [Cloudflare の Codex セットアップ](https://developers.cloudflare.com/agent-setup/codex/)、[Cloudflare の MCP サーバー](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
