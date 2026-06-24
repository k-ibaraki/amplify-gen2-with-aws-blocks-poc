# amplify-gen2-with-aws-blocks-poc

AWS Blocks のコード（バックエンド定義）を保ったまま、デプロイを **Amplify Gen2（`ampx`）に一元化**できるかを検証する PoC。**結論: できた。**

題材は1つの Web アプリ（React + Vite、Todo ＋ 共有メモ）。最終構成は **バックエンドを全て AWS Blocks に一本化**
（Todo = `DistributedTable` / 共有メモ = `KVStore`）し、`amplify/backend.ts` に **`BlocksBackend` を埋め込んで `ampx` でデプロイ**、
**frontend は Amplify Hosting** で配信する。ローカル開発は Blocks のまま（`npm run dev`）。

> ここに至る過程（**Phase 1**: Amplify Todo ＋ Blocks メモの2バックエンド並立 → **Phase 2**: Blocks 一本化）の
> 詳細な実行ログは [`POC-NOTES.md`](./POC-NOTES.md)。コード参照タグ: `phase1`（2バックエンド）/ `phase2`（一本化・最終）。

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

## デプロイ（本番）: Amplify Hosting で frontend ＋ backend を配信

GitHub リポジトリを Amplify Hosting に接続すると、`main` への push で自動ビルド・デプロイされる。
標準ビルドでは足りないので、ルートの [`amplify.yml`](./amplify.yml) で次の3点をカスタムしている。

1. **install は `npm install`** — `@aws-amplify` 系の zod 競合で `npm ci` が（lock 再生成しても）通らないため。
2. **backend は `NODE_OPTIONS="--conditions=cdk" npx ampx pipeline-deploy`** — 無いと building block が mock に落ちて止まる。
3. **frontend は build 時に `client.js` と config.json を生成**
   - CI には dev server が無いので `npm run build`（内部で `generate:client`）が `aws-blocks/client.js` を生成。
   - `aws-blocks/scripts/write-hosting-config.ts` が `amplify_outputs.json` の `custom.blocksApiUrl` を読んで
     `dist/.blocks-sandbox/config.json` を生成。

> 📌 Blocks の設定は `/.blocks-sandbox/config.json`（ドット始まり）に置かれるが、Amplify の成果物グロブ `**/*` は
> ドット始まりディレクトリを拾わない。`amplify.yml` の `artifacts.files` に `.blocks-sandbox/**` を明示追加して配信させている。

---

## PoC の進め方（フェーズ）

- **Phase 1（完了）**: frontend が2バックエンド（Amplify ネイティブ Todo / Blocks 共有メモ）に別々にアクセス
  ＝デプロイ2回・設定2系統・クライアント2つの**二重管理**を体感。
- **Phase 2（完了）**: バックエンドを **AWS Blocks に一本化**（Todo も DistributedTable 化）し、`amplify/backend.ts` に
  `BlocksBackend` を埋め込んで **`ampx` 一発デプロイ**（実 DynamoDB・mock 落ちなし）。さらに frontend を
  **Amplify Hosting（GitHub 連携 CI/CD）** で配信し、本番 URL で end-to-end 動作を確認。

詳細な実行ログは [`POC-NOTES.md`](./POC-NOTES.md)。

---

## ディレクトリ

| パス | 役割 |
|---|---|
| `aws-blocks/index.ts` | Blocks バックエンド本体（Todo=DistributedTable / 共有メモ=KVStore）。定義はここに一本化 |
| `aws-blocks/index.handler.ts` | Lambda ハンドラ |
| `aws-blocks/scripts/server.ts` | ローカル mock dev server（`npm run back`/`dev`） |
| `aws-blocks/scripts/use-amplify-backend.ts` | `front:amplify` 用（`custom.blocksApiUrl` を config に流し込む） |
| `aws-blocks/scripts/generate-client.ts` | CI 用 `client.js` 生成（dev server 非起動時。`npm run build` が使用） |
| `aws-blocks/scripts/write-hosting-config.ts` | Amplify Hosting 用 `config.json` 生成（`custom.blocksApiUrl` から） |
| `amplify/backend.ts` | `defineBackend({})` ＋ `BlocksBackend` 埋め込み（Amplify はデプロイの器） |
| `amplify.yml` | Amplify Hosting のビルド定義（install/backend/frontend のカスタム） |
| `src/App.tsx` | frontend（Blocks クライアント1本で Todo＋共有メモ） |
