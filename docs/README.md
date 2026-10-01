# 設計ドキュメント

初期の設計案と検証計画を含むメモ集です。現行機能は[トップの README](../README.md)、実行・デプロイ方法は[開発ガイド](development-guide.md)を参照してください。

- [目的と前提](product.md): 解決したいこと、初期スコープ、確認待ちの事項
- [画面設計のたたき台](interface.md): 主な画面と操作原則
- [整理モデル](organization.md): 送信元スタック、重要な通知カテゴリ、迷惑メール、配信解除
- [構成とデータの扱い](architecture.md): Cloudflare、Gmail API、認証、セキュリティ
- [決定記録](decisions.md): 合意済みと暫定の判断、その理由
- [実装順序](roadmap.md): 検証から日常利用までの段階
- [開発環境](development.md): CLI とローカル開発の準備
- [現行アプリの開発ガイド](development-guide.md): ローカル起動、Cloudflare 接続版
- [PC のプレビュー](ui-prototype-preview.jpg) / [スマートフォンのプレビュー](ui-prototype-mobile.jpg)
- [初期の画面案](mockup.html): 比較用の以前の HTML モック
- [実装前の検証](validation.md): 分類、初回同期、HTML 表示、OAuth の確認方法

設計の基準日: 2026-09-29。外部サービスの仕様は実装・公開前に再確認する。
