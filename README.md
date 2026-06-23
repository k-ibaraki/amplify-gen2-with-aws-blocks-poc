# amplify-gen2-with-aws-blocks-poc

AWS Blocks のコード（バックエンド定義）を保ったまま、デプロイを **Amplify Gen2（`ampx`）に一元化**できるかを検証する PoC。

題材は1つの Web アプリ（React + Vite）。**Todo は Amplify ネイティブ**（AppSync/DynamoDB）、
**共有メモは AWS Blocks**（KVStore）で、frontend が2つのバックエンドにアクセスする。

> このリポジトリは PoC の進行に合わせて段階的に更新する。現在の状態: **Phase 1（2バックエンド並立）**。

---

## セットアップ

```bash
npm install
aws login            # AWS 認証（環境依存。一時クレデンシャルを取得）
```

リージョンは `ap-northeast-1`。

---

## AWS Blocks の3つの実行モード（使い分け）

AWS Blocks 側（`aws-blocks/`）には用途の異なる3モードがある。**取り違えない**こと。

| モード | コマンド | 何が起きるか | AWS | 用途 |
|---|---|---|---|---|
| **① ローカル実行** | `npm run dev` | Blocks を **mock** で起動（DynamoDB 等はインメモリ）。Vite も同時起動 | 不要 | 日常開発・最速ループ |
| **② Sandbox デプロイ** | `npm run sandbox` | Blocks を**個人用クラウド環境**にデプロイし、frontend をローカル配信（実 AWS リソースに接続） | 要 | 実 AWS での動作確認 |
| **③ 本番デプロイ** | `npm run deploy` | Blocks を**本番スタック**にデプロイ | 要 | リリース時のみ。**ローカル開発では使わない** |

> ⚠️ **やりがちな間違い**: 開発中に ③ `npm run deploy`（本番）を叩くこと。
> ③ は `.blocks-sandbox/config.json` を**本番 API の URL** で上書きするため、その後 `npm run dev` で
> ブラウザ(:3000)を開くと**本番 API を叩いて CORS エラー**になる。
> 開発で実 AWS に触りたいときは ② `npm run sandbox` を使う。

### ① ローカル実行（`npm run dev`）

```bash
npm run dev
```

- Vite: `http://localhost:3000`（**← ブラウザで開くのはここ**）
- Blocks dev server（API, mock）: `http://localhost:3001`
- ブラウザは `/.blocks-sandbox/config.json`（`npm run dev` が `localhost:3001` を指すよう生成）経由で Blocks API を叩く。
- Todo（Amplify）は Amplify にローカルエミュレータが無いため、**デプロイ済みの実 AppSync** に接続する（要 `aws login` + `amplify_outputs.json`）。

もしブラウザで Blocks 側が CORS になったら、③ の本番 config が残っている可能性が高い。
`npm run dev` を**起動し直す**（起動時に `config.json` が localhost に戻る）。

### ② Sandbox デプロイ（`npm run sandbox`）

```bash
npm run sandbox            # Blocks を個人用サンドボックスへ
npm run sandbox:destroy    # 後始末
```

### ③ 本番デプロイ（`npm run deploy`）

```bash
npm run deploy             # Blocks を本番スタックへ（リリース時のみ）
npm run destroy            # 後始末
```

---

## Amplify Gen2 側

```bash
npx ampx sandbox           # Amplify の個人用サンドボックス（auth + data/Todo）。amplify_outputs.json を生成
npx ampx sandbox delete    # 後始末
```

---

## PoC の進め方（フェーズ）

- **Phase 1（現在）**: frontend が2バックエンド（Amplify Todo / Blocks 共有メモ）に別々にアクセス。
  デプロイも `npx ampx sandbox` と `npm run sandbox` で別々＝二重管理で面倒。
- **Phase 2（予定）**: バックエンド定義を AWS Blocks に一本化し、`amplify/backend.ts` に `BlocksBackend` を埋め込んで
  **`ampx` 一発でデプロイ**。frontend は Amplify Hosting で配信。ローカルは引き続き `npm run dev`。

詳細な実行ログは [`POC-NOTES.md`](./POC-NOTES.md)。

---

## ディレクトリ

| パス | 役割 |
|---|---|
| `aws-blocks/index.ts` | Blocks バックエンド本体（共有メモ / KVStore）。デプロイ経路間で共有 |
| `aws-blocks/index.cdk.ts` | ローカル/単独デプロイ用の皮（`BlocksStack`） |
| `aws-blocks/index.handler.ts` | Lambda ハンドラ |
| `amplify/` | Amplify Gen2（`auth` / `data`=Todo / `backend.ts`） |
| `src/App.tsx` | frontend（2バックエンドにアクセス） |
