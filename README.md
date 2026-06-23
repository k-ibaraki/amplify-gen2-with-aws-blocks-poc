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

## ⚠️ 大前提: フロントエンドとバックエンドは別レイヤー

混乱しやすいので最初に固定する。**この2つは独立**していて、コマンドも別。

| レイヤー | ローカル | デプロイ |
|---|---|---|
| **フロントエンド**（`src/`） | **Vite**（`npm run dev:client` → http://localhost:3000） | **Amplify Hosting** |
| **バックエンド**（`aws-blocks/`） | mock / `npm run sandbox` / `npm run amplify:sandbox` | `ampx`（Blocks のリソースをデプロイ） |

- **`npx ampx sandbox` はバックエンド専用**。フロントエンドは出さない。
- 「ローカルでアプリを動かす」=「Vite（フロント）」＋「いずれかのバックエンド」の**組み合わせ**。

---

## バックエンドの実行モード

| モード | コマンド | クラウド | 何が起きるか |
|---|---|---|---|
| **mock**（ローカル） | （`npm run dev` に内包） | 不要 | Blocks をインメモリ mock で起動。最速ループ |
| **Blocks sandbox** | `npm run sandbox` | 要 | Blocks を個人用スタックにデプロイ＋ローカル API 前面(:3001)が実 Lambda へ proxy |
| **Amplify(ampx)** ★Phase 2本命 | `npm run amplify:sandbox` | 要 | **Blocks のリソースを Amplify 経由でデプロイ**（`amplify/backend.ts` の `BlocksBackend`） |
| 本番（Blocks単体） | `npm run deploy` | 要 | Blocks 本番スタック。**PoC/開発では使わない** |

> 🔴 **`ampx` には `NODE_OPTIONS="--conditions=cdk"` が必須**。素の `npx ampx sandbox` だと
> building block が mock に落ちかけて `assertCdkConditionActive()` が即エラーで止める（サイレント死防止）。
> → 忘れないよう **`npm run amplify:sandbox`**（中で `NODE_OPTIONS` を付与）を使う。
>
> 後始末: `npm run amplify:sandbox:delete` / `npm run sandbox:destroy` / `npm run destroy`

---

## フロントエンドの実行

```bash
npm run dev:client    # Vite だけを起動（http://localhost:3000）
```

ブラウザは `/.blocks-sandbox/config.json` の `apiUrl` を見て、どのバックエンドに繋ぐか決まる。

---

## ローカルでアプリを動かす（組み合わせ）

| 試したいバックエンド | コマンド | ブラウザ |
|---|---|---|
| **mock**（AWS 不要・最速） | `npm run dev`（Vite＋mock を一括起動） | http://localhost:3000 |
| **Blocks sandbox**（実 AWS） | ターミナル1: `npm run sandbox` ／ ターミナル2: `npm run dev:client` | http://localhost:3000 |
| **ampx デプロイ済み**（実 AWS） | 先に `npm run amplify:sandbox` でデプロイ → `npm run dev:amplify`（`custom.blocksApiUrl` を config に流し込んで Vite 起動） | http://localhost:3000 |

> 📌 **`npm run dev` は AWS に繋がらない**（完全ローカル mock）。実 AWS のバックエンドに繋ぎたいときは
> `npm run sandbox`（Blocks sandbox）か `npm run dev:amplify`（ampx デプロイ済み）を使う。

> 💡 **CORS でハマったら**: `npm run deploy`（本番）や別モードが `.blocks-sandbox/config.json` を
> 別 URL で上書きしている可能性。`npm run dev`/`npm run sandbox` を起動し直すと正しい URL に戻る。

---

## PoC の進め方（フェーズ）

- **Phase 1（完了）**: frontend が2バックエンド（Amplify ネイティブ Todo / Blocks 共有メモ）に別々にアクセス
  ＝デプロイ2回・設定2系統・クライアント2つの**二重管理**を体感。
- **Phase 2（完了）**: バックエンドを **AWS Blocks に一本化**（Todo も DistributedTable 化）し、`amplify/backend.ts` に
  `BlocksBackend` を埋め込んで **`ampx` 一発デプロイ**。実 DynamoDB が出る（mock 落ちなし）ことを確認済み。
- **残り**: frontend を **Amplify Hosting** で配信し、ホスティング環境で動作確認。

詳細な実行ログは [`POC-NOTES.md`](./POC-NOTES.md)。

---

## ディレクトリ

| パス | 役割 |
|---|---|
| `aws-blocks/index.ts` | Blocks バックエンド本体（Todo=DistributedTable / 共有メモ=KVStore）。デプロイ経路間で共有 |
| `aws-blocks/index.cdk.ts` | ローカル/Blocks 単独デプロイ用の皮（`BlocksStack`） |
| `aws-blocks/index.handler.ts` | Lambda ハンドラ |
| `amplify/backend.ts` | `defineBackend({})` ＋ `BlocksBackend` 埋め込み（Amplify はデプロイの器） |
| `src/App.tsx` | frontend（Blocks クライアント1本で Todo＋共有メモ） |
