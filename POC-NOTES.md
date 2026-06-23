# 実行記録: AWS Blocks のコードを Amplify Gen2 のデプロイに一元化する PoC

> このファイルは Zenn 記事化のための**実行ログ**。各フェーズの「やったコマンド」「実際の出力」「判断」を逐次記録する。
>
> **■ 記事の核（これ一点）**
> **バックエンドのリソース（定義・コード）は AWS Blocks に置いたまま、デプロイを Amplify Gen2（`ampx`）に一元化できるか。**
>
> mock 落ちチェックも end-to-end 動作確認も、すべて「それが本当にできた」を裏づける**材料**に過ぎない（主役ではない）。

## このPoCで確かめたいこと

**1つの Web アプリ**を題材に、次を確かめる:

- **Phase 1（出発点・面倒）**: frontend が **2つのバックエンド**に別々にアクセスする。
  Todo は Amplify ネイティブ（AppSync/DynamoDB）、共有メモは AWS Blocks（KVStore）。
  → デプロイ2回・スタック2つ・設定2系統・クライアント2つで二重管理。
- **Phase 2（ゴール）**: バックエンドの定義を **AWS Blocks に一本化**し、**デプロイを Amplify Gen2（`ampx`）に一元化**。
  frontend は Amplify Hosting で配信。ローカル開発は Blocks のまま。
  - 技術的な核心: `backend.createStack('blocks')` に `BlocksBackend.create()` を埋め込んだとき、
    `--conditions=cdk` が building block まで伝播し、**mock にフォールバックせず実リソース（DynamoDB）が出るか**。

## 環境

| 項目 | 値 |
|---|---|
| リポジトリ | `amplify-gen2-with-aws-blocks-poc`（新規・空リポジトリ） |
| リージョン | `ap-northeast-1` |
| アプリ | React + Vite の SPA。Todo（Amplify）＋ 共有メモ（Blocks）の2機能 |
| Amplify ネイティブ resource | `data` の `Todo`（AppSync + DynamoDB、guest/identityPool） |
| Blocks resource | `KVStore`（DynamoDB 1テーブル。共有メモを保存。mock 落ち判定にも使う） |
| ローカル開発 | `npm run dev`（Blocks dev server:3001 + Vite:3000。Amplify 非依存） |
| デプロイ（最終形） | backend = `ampx`、frontend = Amplify Hosting（手動デプロイ） |

---

## Phase 0 — 準備（AWS 認証不要）

### 手順 0-1: 最小の Amplify Gen2 プロジェクト生成

```bash
npm create amplify@latest -y
```

生成物（最小構成）:
- `amplify/backend.ts` … `defineBackend({ auth, data })`
- `amplify/auth/resource.ts` … email サインインのみ
- `amplify/data/resource.ts` … `Todo` モデル1個（guest 認可）
- devDeps に `aws-cdk-lib@2.244.0` / `constructs` / `tsx` / `esbuild` が同梱（AWS Blocks と共有できる）
- ルート `package.json` は初期状態で `"type": "commonjs"`

### 手順 0-2: AWS Blocks（KVStore 最小バックエンド）を追加

**方針**: 機能コード（`aws-blocks/index.ts`）は今回用に最小で手書き。フレームワークの
プランビングは公式スキャフォルド `npx @aws-blocks/create-blocks-app --template backend` の
出力を正規リファレンスとして最小限のみ持ち込む（前回実験のチャットアプリは持ち込まない）。

追加・変更したファイル:
- `aws-blocks/index.ts` … **KVStore（DynamoDB 1テーブル）** + `set`/`get` の最小 API（手書き）
- `aws-blocks/index.handler.ts` … Lambda ハンドラ（`createLambdaHandler`）
- `aws-blocks/index.cdk.ts` … ローカル/単独デプロイ用の皮（`BlocksStack`）。スタック名は `blocks-poc-stack-*`（"aws" で始めない）
- `aws-blocks/package.json` / `aws-blocks/scripts/{sandbox-id,deploy,destroy}.ts` / `cdk.json` / `tsconfig.json`
- ルート `package.json`: `"type": "module"`、`workspaces: ["aws-blocks"]`、`aws-cdk-lib` を **2.257.0** へ、`@aws-blocks/blocks` 追加、Blocks の3モードスクリプト（`dev`/`sandbox`/`deploy` ＋各 destroy）追加
- `.gitignore`: AWS Blocks 関連（`.blocks-sandbox` 等）を追記

**依存の共存（実リスクの解消）**:
- `@aws-blocks/core` は `aws-cdk-lib ^2.257.0` を要求、Amplify は `^2.234.1` → **2.257.0 で両立**。

```bash
npm install
# → aws-cdk-lib 2.257.0 / constructs 10.6.0 に解決。@aws-blocks/* 一式 + workspace symlink (aws-blocks) OK
```

```bash
npm run typecheck     # → exit 0
```

**ローカル synth による事前検証（AWS 認証不要・課金ゼロ）**:

```bash
NODE_OPTIONS="--conditions=cdk" npx cdk synth --context sandboxMode=true --context projectRoot="$PWD"
```

生成された `cdk.out/blocks-poc-stack-*.template.json` のリソース集計:

```
AWS::DynamoDB::Table        1   ← ★ KVStore が mock ではなく実 construct に解決された
AWS::Lambda::Function       3
AWS::ApiGateway::RestApi    1   （+ Method/Resource/Stage/Deployment）
AWS::IAM::Role              4
AWS::S3::Bucket             1   （Blocks の config 配布用）
AWS::ResourceGroups::Group  2
...
```

→ **`--conditions=cdk` が効けば KVStore は実 DynamoDB テーブルになる**ことを、デプロイ前に無料で実証。
この「DynamoDB が出れば本物 / 消えれば mock 落ち」が Phase 2 の判定軸になる。

---

## Phase 1 — 二重デプロイのベースライン（AWS 認証必要）

### 手順 1-1: Amplify 単独デプロイ

```bash
aws login            # 認証（環境依存。SSO ベースの一時クレデンシャルを取得）
npx ampx sandbox     # 個人用クラウド開発環境を起動（ファイル監視つき）
```

> 注: 本記事の実行は非対話エージェント環境のため、実際には `npx ampx sandbox --once`
> （監視せず1回で終了）で回している。体験として打つのは上記の `npx ampx sandbox`。
> リージョンは `ap-northeast-1` を既定設定済みのため前置き不要。

結果:
- `✔ Deployment completed in 212.696 seconds`
- `amplify_outputs.json` 生成、AppSync エンドポイント発行
- 立ったスタック（ルート）: `amplify-amplifygen2withawsblockspoc-ibarakikeita-sandbox-7dadc39086`
  - ネスト: `...-auth179371D7-...`（Cognito）/ `...-data7552DF31-...`（AppSync + DynamoDB: Todo）

→ **Amplify 単独**は緑。Cognito + AppSync + DynamoDB(Todo) が立つ。

### 手順 1-2: AWS Blocks 単独デプロイ

AWS Blocks には用途の違う**3モード**がある（→ `README.md`）:

| モード | コマンド | 用途 |
|---|---|---|
| ローカル実行 | `npm run dev` | mock で完結。日常開発 |
| **Sandbox デプロイ** | `npm run sandbox` | 個人用クラウドで実 AWS 検証（`ampx sandbox` と対） |
| 本番デプロイ | `npm run deploy` | リリース。ローカル開発では使わない |

Amplify 側が `ampx sandbox`（個人サンドボックス）なので、Blocks 側も**対になる `npm run sandbox`** を使う:

```bash
npm run sandbox     # Blocks を個人用サンドボックスへ（スタック blocks-poc-stack-<id>）
```

> 🐛 **ハマりどころ（記事の教訓）**: 当初これを誤って `npm run deploy`（**本番**）で実行してしまった。
> すると本番スタック `blocks-poc-stack-prod` が立つだけでなく、`.blocks-sandbox/config.json` が
> **本番 API Gateway の URL** で上書きされる。その状態で `npm run dev` のブラウザ(:3000)を開くと、
> ブラウザが本番 API を叩いて **CORS エラー**になった。
> 教訓: **開発中に本番デプロイを叩かない**。実 AWS に触りたいなら `npm run sandbox`。
> （誤って作った本番スタックは `npm run destroy` で破棄済み。）

→ Amplify(`ampx sandbox`) と Blocks(`npm run sandbox`) の**両方が個人サンドボックス**で揃い、対称な比較になる。

### 手順 1-3: frontend を足して「2バックエンドにアクセスする実アプリ」にする

React + Vite の SPA を追加（`src/App.tsx`）。1つの画面が **2つのバックエンドに別々のクライアントで**アクセスする:

| 機能 | バックエンド | frontend のクライアント | 設定ファイル |
|---|---|---|---|
| Todo（追加/一覧/削除） | Amplify ネイティブ（AppSync/DynamoDB） | `aws-amplify/data` の `generateClient<Schema>()` | `amplify_outputs.json` |
| 共有メモ（保存/読込） | AWS Blocks（KVStore） | `import { api } from 'aws-blocks'` | `.blocks-sandbox/config.json` |

ローカル起動:

```bash
npm run dev   # Blocks dev server(:3001, mock) + Vite(:3000) を同時起動
```

→ ブラウザで開くのは **http://localhost:3000**（Vite）。Blocks API は `config.json` 経由で :3001 に届く（dev server が localhost CORS を許可）。

ブラウザ自動操作（Playwright）で動作確認した結果:

```json
{
  "todoVisibleImmediately": true,        // Amplify: Todo 追加が即反映
  "noteStatus": "保存しました ✓",          // Blocks: 共有メモ保存OK
  "todoPersistedAfterReload": true,      // リロード後も残る（実 AppSync に永続）
  "notePersistedAfterReload": true,      // リロード後も残る（dev server 内）
  "errors": []                           // コンソールエラーなし
}
```

→ **2バックエンドにアクセスする実 Web アプリが動作**。スクショ: `/tmp/poc-shots/02-after-actions.png`
（オレンジ枠=Amplify Todo / 青枠=Blocks 共有メモ。各パネルに使用クライアントと設定ファイルを明記）。

> ⚠️ **ローカル開発の非対称性（Phase 1 の地味な面倒）**: `npm run dev` 時、Blocks 側は
> ローカル mock で完結するが、**Amplify 側にはローカルエミュレータが無い**ため Todo は
> 実デプロイ済みの AppSync を叩く（＝ローカル開発なのにクラウド依存）。Phase 2 で
> backend を Blocks に寄せると、ローカルは全て mock で完結する（これは Phase 2 の利点）。

### 状態整理（2スタック並立）

今回のPoCで立った**2つの独立スタック**:

| デプロイ口 | コマンド | スタック | 主なリソース | フロント設定の出力先 |
|---|---|---|---|---|
| Amplify | `npx ampx sandbox` | `amplify-amplifygen2withawsblockspoc-...-sandbox-7dadc39086`（+auth/data ネスト） | Cognito / AppSync / DynamoDB(Todo) | `amplify_outputs.json` |
| AWS Blocks | `npm run sandbox` | `blocks-poc-stack-kibaraki-tk091d` | Lambda / API Gateway / DynamoDB(KVStore) | `.blocks-sandbox/config.json`（`environment: sandbox`） |

→ 両方とも CREATE_COMPLETE。**2つの個人用サンドボックスが並立**（記事の「二重管理」図はこの状態をキャプチャ）。

### 🛑 ここで一旦停止 — 「二重で面倒」を体感する（＝一元化の動機）

実際にやってみて確認できた不便さ:

1. **frontend が2クライアント・2設定**: 同じ画面なのに Amplify 用と Blocks 用でクライアントも設定ファイルも別系統。
2. **デプロイが2コマンド**: `npx ampx sandbox` と `npm run sandbox` の両方。片方忘れると食い違う（drift）。
3. **スタックが2つ**: CloudFormation 上に別スタックが並び、ライフサイクルを別々に管理。
4. **ローカル開発が非対称**: Blocks は mock で完結、Amplify は実クラウド依存（上記⚠️）。
5. **片付けも2コマンド**: `ampx sandbox delete` と `npm run sandbox:destroy`。

→ この「同じ1アプリなのに2系統」を解消するのが Phase 2。

---

## Phase 2 — Amplify へ一元化（AWS 認証必要）

### 手順 2-1: バックエンドを Blocks に一本化

- `aws-blocks/index.ts`: Todo を **DistributedTable**（DynamoDB）で実装し直し、共有メモの **KVStore** と合わせて Blocks に集約。
- `src/App.tsx`: Amplify Data クライアントを撤去し、**`import { api } from 'aws-blocks'` の1クライアント**で Todo もメモも呼ぶ。
- `amplify/backend.ts`: 定義は全部 Blocks 側にあるので **`defineBackend({})`（空の器）** にして BlocksBackend を埋め込む:

```ts
const backend = defineBackend({});
const blocksStack = backend.createStack('blocks');
const blocks = await BlocksBackend.create(blocksStack, 'blocks', {
  backendHandlerPath: join(__dirname, '../aws-blocks/index.handler.ts'),
  backendCDKPath:     join(__dirname, '../aws-blocks/index.ts'),
});
RemovalPolicies.of(blocksStack).destroy();
blocks.handler.addEnvironment('CORS_ALLOWED_ORIGINS', '.*'); // PoC: 全許可（本番は絞る）
backend.addOutput({ custom: { blocksApiUrl: blocks.apiUrl } });
```

**ローカル検証（AWS 不要）**: `npm run dev` → `:3000` で Todo もメモも **全て Blocks の mock で完結**
（Phase 1 と違い Amplify 実 AppSync 依存がない＝完全ローカル）。Playwright で永続・CORSなし・エラーなしを確認。

### 手順 2-2: ampx 一発でデプロイ

```bash
NODE_OPTIONS="--conditions=cdk" npx ampx sandbox
```

- `✔ Deployment completed in 233.371 seconds`
- 既存 sandbox から **auth/data（Cognito/AppSync/Todo）を削除**し、**blocks ネストスタックを追加**する更新。
- `amplify_outputs.json` に **`custom.blocksApiUrl: https://0j8dhbtbzk.execute-api.ap-northeast-1.amazonaws.com/prod/aws-blocks/api`** が出力。
- `npm run deploy:blocks` / `npm run sandbox`（Blocks 側デプロイ）は**もう不要**。デプロイ口は ampx 一本。

### 手順 2-3: 検証 — mock 落ちしていないか＆実応答（このPoCの核）

**(A) デプロイ済みスタックの実リソース**: Amplify 配下の blocks ネストスタックに **DynamoDB テーブル2つ**:

```
amplify-...-sandbox-7dadc39086-blocks-blocks-poc-store    （KVStore: 共有メモ）
amplify-...-sandbox-7dadc39086-blocks-blocks-poc-todos    （DistributedTable: Todo）
```

→ `--conditions=cdk` が **ampx の tsImport → BlocksBackend.create → index.ts のネスト import** まで伝播し、
building block が **mock ではなく実 CDK construct に解決**された。mock 落ちしていない。

**(B) API の実応答（end-to-end の本証明）**: `custom.blocksApiUrl` に実リクエスト:

```
[Blocks] Using API (env BLOCKS_API_URL): https://0j8dhbtbzk.execute-api.ap-northeast-1.amazonaws.com/prod/aws-blocks/api
saveNote→loadNote: { text: "deployed-note-72515" }              # KVStore 実往復
createTodo→listTodos: { content: "deployed-todo-72515", pk: "todo", id: "...", createdAt: ... }  # DistributedTable 実往復
```

→ **リソース定義は Blocks のまま、Amplify(ampx) がデプロイし、実 DynamoDB に永続**。記事の核心が成立。

### 手順 2-4: ローカルでの2バックエンドモード検証（フロント/バック分離）

**前提**: フロントエンドとバックエンドは別レイヤー。`npx ampx sandbox` は**バックエンド専用**でフロントは出さない。
フロントは常に Vite（ローカル）または Amplify Hosting（デプロイ）。

| バックエンド | 起動 | フロント | 結果 |
|---|---|---|---|
| Blocks **mock** | `npm run dev`（Vite＋mock 一括） | 同梱 Vite(:3000) | ✅ 全 mock で Todo/メモ動作 |
| Blocks **sandbox** | `npm run sandbox`（API 前面:3001→実Lambda） | 別途 `npm run dev:client`(:3000) | ✅ 実 sandbox Lambda→DynamoDB に接続して動作 |

- `ampx` 実行時のハマり: 素の `npx ampx sandbox` は `Missing --conditions=cdk` で即停止（guard）。
  → `npm run amplify:sandbox`（`NODE_OPTIONS=--conditions=cdk` を付与）でラップした。
- `npm run sandbox` は**フロントを配信しない**（API 前面 :3001 のみ）。フロントは Vite を別途起動する。

> 📝 上記までの手順で使っているコマンド名（`npm run sandbox` / `amplify:sandbox` / `dev:client` 等）は
> **Phase 1〜2 探索時点のもの**。統合が固まった後に下記 手順 2-5 で整理し直した（記事では各 Phase は当時の
> 名前で説明し、最後に「整理後の体系」を提示する構成が読みやすい）。

### 手順 2-5: 統合結果を踏まえてコマンド体系を整理

一元化が完成して「デプロイは ampx 一本」になったので、Phase 1 で増えていったコマンド群を
**接頭辞＝役割**で整理し直し、不要なものを削除した。

**整理の指針**: フロント/バックは別レイヤーなので名前で区別する。デプロイ経路は ampx 一本に絞る。

| 旧（探索時） | 新（整理後） | 役割 |
|---|---|---|
| `dev:client` | **`front`** | フロント（Vite）を起動 |
| `dev:server` | **`back`** | mock バックエンドを起動 |
| `dev` | `dev` | front＋back を一括（ローカル mock） |
| `dev:amplify` / `connect:amplify` | **`front:amplify`** | フロントを ampx デプロイ済み backend に繋いで起動 |
| `amplify:sandbox` | **`deploy:amplify`** | ampx で Blocks をデプロイ（`NODE_OPTIONS=--conditions=cdk` 付与） |
| `amplify:sandbox:delete` | **`destroy:amplify`** | 後始末 |
| `sandbox` / `deploy`（Blocks 単体） | **削除** | 一元化の趣旨に反する重複デプロイ経路のため撤去 |

あわせて Blocks 単体 CDK デプロイ用のファイル（`index.cdk.ts` / `cdk.json` / `scripts/{sandbox,deploy,destroy,…}.ts`）も削除。
→ 最終的なコマンド体系は `README.md` を参照。

---

## Phase 3 — 成功判定と片付け

### 成功チェックリスト

- [x] `NODE_OPTIONS="--conditions=cdk" npx ampx sandbox` が完走する（233s）
- [x] 実リソース（DynamoDB Table×2: store/todos）が Amplify 配下に出ている（mock 落ちなし）
- [x] `custom.blocksApiUrl` を叩くと**実レスポンス**が返る（note/todo 往復）
- [x] デプロイが **`ampx` 一発**で完結する（`npm run deploy:blocks`/`sandbox` 不要）
- [x] ローカル `npm run dev`（`:3000`）が Amplify 非依存で動く（全 mock）
- [ ] **frontend を Amplify Hosting で配信**し、ホスティング環境で両機能が動く（← 残り）

### 片付け

<!-- コマンドと出力をここに記録 -->

---

## 補足: データ層のアーキテクチャ差（Amplify `data` ⇔ AWS Blocks）

同じ「DynamoDB に保存する Todo」でも、**標準アーキテクチャがそもそも違う**。

| | Amplify `data`（`defineData`） | AWS Blocks |
|---|---|---|
| フロント↔バック | **AppSync（GraphQL）** | **API Gateway（REST）+ JSON-RPC** |
| コンピュート | 基本 CRUD は **Lambda なし**（AppSync の直接 DynamoDB リゾルバ） | **単一 Lambda** が全リクエスト処理（API GW → Lambda → DynamoDB を SDK 経由） |
| リアルタイム | GraphQL Subscriptions（標準） | `Realtime` ブロックを足す（WebSocket） |
| 認可 | スキーマに宣言（`allow.owner()` 等） | コード内で `auth.requireAuth(context)` |
| スタイル | スキーマ・ファースト（GraphQL） | **コード・ファースト**（TS 関数が RPC エンドポイントに） |

> `BlocksBackend` の JSDoc にも *"a single Lambda function fronted by API Gateway with RPC +
> catch-all proxy routing"* と明記。`ApiNamespace` のメソッドも `KVStore`/`DistributedTable` の
> 操作も**全部この1つの Lambda 経由**。

**このPoCでの含意**: Phase 1→2 で Todo を Amplify `data`(AppSync) → Blocks(API GW+Lambda) に移したので、
同じ DynamoDB 保存でも経路が変わった。
- Phase 1 Todo: ブラウザ → **AppSync** → DynamoDB（Lambda を通らない）
- Phase 2 Todo: ブラウザ → **API Gateway → Lambda** → DynamoDB

ざっくりした傾向:
- **AppSync 型**: 単純 CRUD は Lambda レスで速い・安い・スケールしやすい。GraphQL/リゾルバの世界観に乗る前提。
- **API GW + Lambda 型（Blocks）**: API メソッドに任意の TS ロジックを書ける（コードファースト）。代わりに
  全リクエストが Lambda を通る（コールドスタート・呼び出し課金）。

> ⚠️ **あくまで「各フレームワークの標準」の話**。Amplify も Blocks も土台は CDK なので、
> CDK を直接書けばどちらの構成でも組める（Amplify は `backend.createStack()` で任意の CDK construct を
> 追加でき、実際このPoCの BlocksBackend 埋め込みもそれ）。「標準ではこうなる」という比較。

---

## 結論

<!-- 白黒ついた結論をここに記録 -->
