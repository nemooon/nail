# nail の開発・デプロイ

現行の React + Mantine の画面、Hono API、Cloudflare Worker を含むアプリ。Cloudflare 接続版・ローカル開発版で画面を共有する。

ローカル開発では Hono API 経由で Gmail に接続する。API は `127.0.0.1:8767`、画面は `127.0.0.1:5173` にのみバインドする。Gmail のトークンはサーバー側で保持し、ブラウザーには渡さない。

## ローカルで起動

Node.js 26 でリポジトリのルートから `npm ci`、`npm run dev`。事前に[ローカル OAuth の設定](local-gmail.md)を行う。`http://127.0.0.1:5173/` を開く。初回認証または権限の再同意が必要な場合は、画面の再認証リンクから Google の同意を完了する。ローカル OAuth コールバックは `127.0.0.1:8766` で待ち受ける。

`npm run build` で画面・API・同期コードの型チェックと画面ビルドを実行できる。`npm test` で HTML メール表示、ローカル API のアクセス制限、分類の優先順位を確認する。

## Cloudflare 接続版

React の静的ファイルと Hono API を Workers Static Assets で配信し、D1 `nail-mail` に暗号化した Google 更新トークン、セッション、受信箱のメタデータ、分類修正を保存する。本文・添付は保存せず、開いたときだけ Gmail API から取得する。公開 URL はログイン前でも画面を表示するが、`/api/*` のメール・分類データは所有者のセッションがないと返さない。

ログインした Google アカウントの検証済みメールアドレスと固定された所有者の `sub` を照合し、`gmail.modify` の同意後に 7 日間の HttpOnly セッションを発行する。変更リクエストは新ドメインの同一オリジンに制限する。Google Auth Platform が Testing の間は、Google の仕様で更新トークンが 7 日で切れる可能性がある。

`npm run build:live` は `cf build` と Cloudflare Vite プラグインで画面・Worker をビルドし、生成型を含めて型チェックする。`npm run deploy:live` はビルド後に `cf deploy --prebuilt` で `cloudflare.config.ts` の `nail` Worker にデプロイする。D1 のスキーマ変更は `migrations/` で管理する。OAuth クライアント ID・シークレット、AES-GCM の 256-bit 鍵、所有者メールアドレスは Worker Secrets に登録し、リポジトリやブラウザーに置かない。Worker の認証用 Secrets は `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`TOKEN_ENCRYPTION_KEY`、`OWNER_EMAIL`。

Cloudflare の無料枠で同期できるよう、受信箱の初回同期は 1 リクエスト当たり最大 24 通のメタデータ取得に分割して D1 に進捗を残す。検索とアーカイブも 1 ページ当たり最大 35 通。画面は同期完了まで順次リクエストし、以降は Gmail の履歴から差分を取得する。送信元スタックの一括ゴミ箱移動は 35 通まで。

## 現在使える機能

- 受信箱は同期済みのメタデータを表示し、起動時・手動更新時・画面が見えている間の定期更新時に Gmail 差分同期を行う。
- 検索とアーカイブ一覧は Gmail API から取得する。検索は Gmail の構文を使い、Cloudflare 接続版は35件、ローカル版は50件ずつ追加で読み込める。
- 本文は開いたときだけ Gmail から取得する。HTML の表・文字装飾・安全な CSS を保持し、隔離したフレームを本文の高さに合わせて表示する。スクリプト・フォームは遮断する。外部画像は初期状態で読み込み、「設定」で自動表示をオフにできる。オフの場合もメールごとのボタンで表示できる。設定はこのブラウザーに保存する。
- プレーンテキストの本文では HTTP/HTTPS の URL を新しいタブで開けるリンクとして表示する。
- `gmail.modify` の再同意後、既読・未読・アーカイブ・ゴミ箱操作を Gmail に反映する。送信機能は実装していない。プロモーションの送信元スタックには確認付き一括操作がある。
- 件名の明確な通知・広告表現から重要通知5カテゴリとプロモーションを自動分類し、判定理由を表示する。曖昧なメールは「その他」として受信箱に残す。Gmail のプロモーションラベルは補助判定に使う。
- 分類修正は「この1通だけ」または「同じ送信元の今後のメールにも適用」から選べる。後者は件名に含む語で条件を絞れる。Cloudflare 接続版では D1 に保存する。ローカル版では個別修正は `.classifications.json`、送信元ルールは `.classification-rules.json` に保存する。Gmail のラベルは変更しない。Workers AI による分類は未接続。

ローカル版の認証情報、同期状態、分類ファイルは `.local/` にあり、Git から除外している。`src/local/` はローカル開発用、`src/worker/` は Cloudflare 接続版の API。両者の保存先と認証方法は異なる。
