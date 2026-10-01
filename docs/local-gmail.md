# ローカル Gmail 認証・同期

Gmail API の全件走査と差分同期の挙動・負荷を確認するためのローカル実装。Gmail API クライアントは現行アプリでも利用している。`scripts/sync.ts` による同期では本文と添付は取得しない。受信箱の ID、件名、差出人、日時、既読状態だけをローカル JSON に保存する。送信やラベル変更は行わない。

## 実行

リポジトリのルートで `npm ci` を実行する。`.local/` を作成し、Google Cloud から取得した OAuth クライアントの JSON を `.local/.oauth-client.json` に保存する。ファイルの権限は `0600` にする。Node.js 26 で初回は `npm run auth` を実行する。表示された `http://localhost:8766/` を開き、`nemooon@gmail.com` で Gmail の閲覧・整理権限（`gmail.modify`）に同意する。認証後は `npm run sync` で同期する。アクセストークンは期限前に自動更新する。再認証が必要になった場合は `npm run auth` を実行し直す。認証情報は `.local/.oauth-token.json` に権限 `0600` で保存されるため、共有・コミットしない。状態ファイルはリポジトリの `.local/.gmail-sync-state.json`（別の場所にする場合は `GMAIL_SYNC_STATE`）。このファイルには実メールのメタデータが入るため、共有・コミットしない。

Google Cloud プロジェクト `nos-nail` で Gmail API と Google Auth Platform を設定済み。アプリ `Nail Mail` は外部ユーザー向けのテスト状態で、テストユーザーは `nemooon@gmail.com` のみ。`gmail.readonly` に加えて `gmail.modify` を登録した。ローカルのウェブアプリ用 OAuth クライアント `Nail Mail (local)` のリダイレクト URI は `http://localhost:8766/oauth/callback`。クライアント認証情報は `.local/.oauth-client.json` に権限 `0600` で保存しており、共有・コミットしない。ローカル認可は `state` と PKCE で保護し、Gmail プロフィールからアカウントを確認してからトークンを保存する。`gmail.modify` の利用には本人の再同意が必要。

初回は最大 500 通ずつ受信箱を走査し、ページごとに状態を保存する。次回は最後のページから再開し、走査開始後に発生した変更を `history.list` で反映する。同期後の実行は差分だけを取得する。履歴またはページトークンが無効なら全件走査からやり直す。`429` と `5xx` は短い指数バックオフで再試行する。

各ページの進捗と、完了時に所要時間・API 呼び出し数・概算 quota units を出力する。`messages.get` が Gmail API 上で 20 units なので、全件走査はメール件数に比例して重い。概算値は再試行分を含まない。

2026-09-30 に本人の同意後、実アカウントで初回同期と差分同期を確認した。初回は受信箱 147 通、未読 5 通を保存し、差分同期は `history.list` 1 回で完了した。OAuth クライアント、トークン、同期状態の各ファイルは権限 `0600`。

## テスト

`npm test`

## Cloudflare 接続版との関係

現行の [Cloudflare 接続版](development-guide.md)では、Worker 側に OAuth、所有者の確認、更新トークンの暗号化保存、D1 を使った分割同期・差分同期を実装している。`.local/` の JSON や認証情報はデプロイしない。
