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
| `front:*` | **フロントを“指定バックエンド”で起動** | `front:amplify`（ampx sandbox 済み backend に繋いで Vite） |
| `sandbox:amplify*` | **個人用クラウド sandbox を作成/更新/削除** | `sandbox:amplify`（ampx sandbox・監視）/ `sandbox:amplify:once`（1回）/ `sandbox:amplify:delete` |

> 個人用クラウドへ出す口は **`ampx sandbox` 一本**（`sandbox:amplify`）。**本番デプロイは別物**で、
> Amplify Hosting の CI（`main` への push → `ampx pipeline-deploy`）が担う（npm script は持たない）。
> AWS Blocks 単体の `cdk deploy` 系コマンドは一元化の趣旨に反するので置いていない（＝この PoC の結論）。

---

## ローカルでアプリを動かす（組み合わせ）

| 試したいバックエンド | コマンド | ブラウザ |
|---|---|---|
| **mock**（AWS 不要・最速） | `npm run dev` | http://localhost:3000 |
| **ampx sandbox 済み**（実 AWS） | 先に `npm run sandbox:amplify` → `npm run front:amplify` | http://localhost:3000 |

- `npm run dev` は **front（Vite）＋ back（mock）** を一括起動。
- `npm run front:amplify` は `amplify_outputs.json` の `custom.blocksApiUrl` を `.blocks-sandbox/config.json` に
  書き込んでから Vite を起動（CORS は backend 側で許可済み）。

> 📌 **`npm run dev` は AWS に繋がらない**（完全ローカル mock）。実 AWS の backend に繋ぎたいときは
> `npm run front:amplify`（ampx sandbox 済み）を使う。
>
> 💡 **CORS でハマったら**: 別モードが `.blocks-sandbox/config.json` を別 URL で上書きした可能性。
> `npm run dev`（mock）か `npm run front:amplify`（ampx）を起動し直すと正しい URL に戻る。

---

## 認証（Amplify ネイティブ Cognito を AWS Blocks が消費）

> ⚠️ 現状: **ローカル(mock) + Sandbox 検証済み**（ブラウザで実ログイン → 認証付き API まで確認）。本番(Amplify Hosting)は検証中（[`POC-NOTES-2.md`](./POC-NOTES-2.md)）。

**Amplify ネイティブの Cognito**（`amplify/auth/resource.ts` の `defineAuth`）を、**AWS Blocks が
`AuthCognito.fromExisting()` で消費**する hybrid 構成。API はすべて認証必須（`requireAuth`）。

- frontend は Blocks の `<Authenticator>` / `AccountMenuBar` でログイン。**`aws-amplify` は使わない**（純 Blocks のまま）。
- 3環境の Cookie 差は **`crossDomain`** で吸収（`SameSite=Lax` ⇔ `None; Secure`）:
  - **ローカル mock** = Blocks 自前プール、Cookie `SameSite=Lax`（loopback で可）。
  - **Sandbox/本番** = Amplify の実 Cognito を wrap、frontend と API が別オリジンなので Cookie は cross-domain（`SameSite=None; Secure`）。
  > ⚠️ **要注意**: `crossDomain` は **Lambda ランタイムで評価**される。synth 専用の `AMPLIFY_USER_POOL_ID`
  > （`backend.ts` が synth プロセスで set するだけ）はランタイムに無いので判定に使えない。
  > → `amplify/backend.ts` が **Lambda env に `BLOCKS_CROSS_DOMAIN='true'`** を立て、`aws-blocks/index.ts` が
  > `process.env.BLOCKS_CROSS_DOMAIN === 'true'` を読む（ローカル mock は env 無し → false）。
- `BlocksBackend` と auth が循環参照にならない設計（依存は `blocks→auth` 一方向）は [`POC-NOTES-2.md`](./POC-NOTES-2.md)。

### ローカルでログインする（確認コードの入手）

ローカル mock は AWS 不要だが **メール送信が無い**ため、確認コードは mock がローカルに保存・出力する
（公式 `@aws-blocks/bb-auth-cognito` の *Local Development* / *"local-only verification-code capture"* に準拠）。

1. （詰まったら先に）状態をリセット: `rm -rf .bb-data`（mock のローカル状態のみ・gitignore 済み）
2. `npm run dev` を起動 → 画面でサインアップ
3. 確認コードを入手（どちらでも可）:
   - **`[back]` コンソール**（`npm run dev` のターミナル）: `🔑 [mock auth] signUp の確認コード（you@example.com）: 646088`
   - **ファイル**: `.bb-data/blocks-poc-auth/last-code.json` の `code`
4. その6桁を「Verification Code」に入力 → 確認 → サインイン

> ⚠️ **「Invalid code」になったら**:
> - **コードは username 単位**。`last-code.json` の `username` が**今サインアップしたメールと一致**しているか確認（別ユーザーの古いコードは無効）。
> - **コードは約10分で失効**。遅れたら確認画面の **「Resend Code」**で再発行。
> - 既存メールで再サインアップすると `User already exists` で**新しいコードは出ない** → `rm -rf .bb-data` でクリーンにするのが速い。

> 📌 コード出力に使う `codeDelivery`（`aws-blocks/index.ts`）は **mock 専用**。クラウドは実 Cognito が
> メールでコードを送るので、この console 出力は出ない（cross-domain Cookie も実環境のみ）。

---

## バックエンドを個人用クラウドへ（ampx sandbox）

```bash
npm run sandbox:amplify        # NODE_OPTIONS=--conditions=cdk を付けて ampx sandbox（対話・監視）
npm run sandbox:amplify:once   # 監視せず1回（CI/エージェント用）
npm run sandbox:amplify:delete # 後始末
```

> 🔴 **`ampx` には `NODE_OPTIONS="--conditions=cdk"` が必須**。素の `npx ampx sandbox` だと building block が
> mock に落ちかけて `assertCdkConditionActive()` が即エラーで止まる（サイレント死防止）。
> → `npm run sandbox:amplify` が `NODE_OPTIONS` を付与するので、これを使えば忘れない。

> 📌 これは**個人用 sandbox**（`ampx sandbox`）であって本番デプロイではない。本番は次節の Amplify Hosting（CI）。

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
- **Phase 3（進行中）**: キレイに一本化した構成に **Amplify ネイティブの Auth（Cognito）を"足す"** hybrid。
  Blocks が `fromExisting` で消費し、API を認証必須化（循環参照なしを実機で確認済み）。ローカル検証済み・Sandbox/本番は検証中。

詳細な実行ログは [`POC-NOTES.md`](./POC-NOTES.md)（Phase 1–2）／ [`POC-NOTES-2.md`](./POC-NOTES-2.md)（Phase 3・認証）。

---

## ディレクトリ

| パス | 役割 |
|---|---|
| `aws-blocks/index.ts` | Blocks バックエンド本体（Todo=DistributedTable / 共有メモ=KVStore / 認証=AuthCognito）。API は `requireAuth` で認証必須 |
| `aws-blocks/index.handler.ts` | Lambda ハンドラ |
| `aws-blocks/scripts/server.ts` | ローカル mock dev server（`npm run back`/`dev`） |
| `aws-blocks/scripts/use-amplify-backend.ts` | `front:amplify` 用（`custom.blocksApiUrl` を config に流し込む） |
| `aws-blocks/scripts/generate-client.ts` | CI 用 `client.js` 生成（dev server 非起動時。`npm run build` が使用） |
| `aws-blocks/scripts/write-hosting-config.ts` | Amplify Hosting 用 `config.json` 生成（`custom.blocksApiUrl` から） |
| `amplify/auth/resource.ts` | Amplify ネイティブ認証（`defineAuth` の Cognito）。Blocks が `fromExisting` で消費 |
| `amplify/backend.ts` | `defineBackend({ auth })` ＋ `BlocksBackend` 埋め込み。poolId を env で Blocks に渡す（Amplify はデプロイの器） |
| `amplify.yml` | Amplify Hosting のビルド定義（install/backend/frontend のカスタム） |
| `src/App.tsx` | frontend（Blocks クライアント1本で Todo＋共有メモ） |
