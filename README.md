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
| **フロントエンド**（`src/`） | **Vite**（`npm run front` → http://localhost:3000） | **Amplify Hosting** |
| **バックエンド**（`aws-blocks/`） | mock（`npm run back`） / ampx デプロイ済み | `ampx`（Blocks のリソースをデプロイ） |

- **`ampx` はバックエンド専用**。フロントエンドは出さない。
- 「ローカルでアプリを動かす」=「Vite（フロント）」＋「いずれかのバックエンド」の**組み合わせ**。

---

## コマンド体系（接頭辞で役割が一意）

| 接頭辞 | 意味 | コマンド |
|---|---|---|
| `dev` / `front` / `back` | **ローカルで起動** | `dev`（front＋mockback 一括）/ `front`（Vite だけ）/ `back`（mock backend だけ） |
| `front:*` | **フロントを“指定バックエンド”で起動** | `front:amplify`（ampx デプロイ済み backend に繋いで Vite） |
| `deploy:*` / `destroy:*` | **バックエンドをクラウドへ／撤去** | `deploy:amplify`（ampx で Blocks をデプロイ）/ `destroy:amplify` |

> デプロイ経路は **ampx 一本**（`deploy:amplify`）。AWS Blocks 単体の `cdk deploy` 系コマンドは、
> 一元化の趣旨に反するので置いていない（＝この PoC の結論）。

---

## ローカルでアプリを動かす（組み合わせ）

| 試したいバックエンド | コマンド | ブラウザ |
|---|---|---|
| **mock**（AWS 不要・最速） | `npm run dev` | http://localhost:3000 |
| **ampx デプロイ済み**（実 AWS） | 先に `npm run deploy:amplify` → `npm run front:amplify` | http://localhost:3000 |

- `npm run dev` は **front（Vite）＋ back（mock）** を一括起動。
- `npm run front:amplify` は `amplify_outputs.json` の `custom.blocksApiUrl` を `.blocks-sandbox/config.json` に
  書き込んでから Vite を起動（CORS は backend 側で許可済み）。

> 📌 **`npm run dev` は AWS に繋がらない**（完全ローカル mock）。実 AWS の backend に繋ぎたいときは
> `npm run front:amplify`（ampx デプロイ済み）を使う。
>
> 💡 **CORS でハマったら**: 別モードが `.blocks-sandbox/config.json` を別 URL で上書きした可能性。
> `npm run dev`（mock）か `npm run front:amplify`（ampx）を起動し直すと正しい URL に戻る。

---

## デプロイ（バックエンド）

```bash
npm run deploy:amplify        # NODE_OPTIONS=--conditions=cdk を付けて ampx sandbox（対話・監視）
npm run deploy:amplify:once   # 監視せず1回（CI/エージェント用）
npm run destroy:amplify       # 後始末
```

> 🔴 **`ampx` には `NODE_OPTIONS="--conditions=cdk"` が必須**。素の `npx ampx sandbox` だと building block が
> mock に落ちかけて `assertCdkConditionActive()` が即エラーで止まる（サイレント死防止）。
> → `npm run deploy:amplify` が `NODE_OPTIONS` を付与するので、これを使えば忘れない。

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
