# 実行記録: AWS Blocks のコードを Amplify Gen2 のデプロイに一元化する PoC

> このファイルは Zenn 記事化のための**実行ログ**。各フェーズの「やったコマンド」「実際の出力」「判断」を逐次記録する。
> 記事の核は **Phase 2 の mock 落ち判定（DynamoDB が実体で出るか）** なので、その grep 結果は必ず verbatim で残す。

## このPoCで確かめたいこと（1行）

AWS Blocks のコード本体を `aws-blocks/index.ts` に置いたまま、**デプロイだけ Amplify Gen2 の `ampx` に一元化**できるか？
（`backend.createStack('blocks')` に `BlocksBackend.create()` を埋め込んだとき、`--conditions=cdk` が building block まで伝播し、**mock にフォールバックせず実リソースが出るか**が全て）

## 環境

| 項目 | 値 |
|---|---|
| リポジトリ | `amplify-gen2-with-aws-blocks-poc`（新規・空リポジトリ） |
| リージョン | `ap-northeast-1` |
| 検証用 building block | `KVStore`（DynamoDB テーブル1個 → mock 落ち判定が最も明快） |
| フロントエンド | なし（PoC の主役ではないため省略。API 疎通は typed-client スクリプトで確認） |
| `@aws-blocks/blocks` | （Phase 0 で記録） |

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
- ルート `package.json`: `"type": "module"`、`workspaces: ["aws-blocks"]`、`aws-cdk-lib` を **2.257.0** へ、`@aws-blocks/blocks` 追加、`deploy:blocks`/`destroy:blocks` スクリプト追加
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
AWS_REGION=ap-northeast-1 npx ampx sandbox --once
```

結果:
- `✔ Deployment completed in 212.696 seconds`
- `amplify_outputs.json` 生成、AppSync エンドポイント発行
- 立ったスタック（ルート）: `amplify-amplifygen2withawsblockspoc-ibarakikeita-sandbox-7dadc39086`
  - ネスト: `...-auth179371D7-...`（Cognito）/ `...-data7552DF31-...`（AppSync + DynamoDB: Todo）

→ **Amplify 単独**は緑。Cognito + AppSync + DynamoDB(Todo) が立つ。

### 手順 1-2: AWS Blocks 単独デプロイ

```bash
npm run deploy:blocks   # = tsx aws-blocks/scripts/deploy.ts（内部で NODE_OPTIONS=--conditions=cdk の cdk deploy）
```

結果:
- `✅ blocks-poc-stack-prod`（`Deployment time: 112.54s`）
- API URL: `https://0sa9yehbui.execute-api.ap-northeast-1.amazonaws.com/prod/aws-blocks/api`
- フロント設定は **`.blocks-sandbox/config.json`**（`{ apiUrl, environment }`）に出力（Amplify とは別系統）
- スタック `blocks-poc-stack-prod` のリソース実体: **`AWS::DynamoDB::Table` 1**（物理名 `blocks-poc-stack-prod-blocks-poc-store`）/ Lambda 3 / API Gateway 一式

→ **AWS Blocks 単独**も緑。KVStore は実 DynamoDB として作成（mock ではない）。

### 手順 1-3: 状態確認（2スタック並立）

今回のPoCで立った**2つの独立スタック**:

| デプロイ口 | コマンド | スタック | 主なリソース | フロント設定の出力先 |
|---|---|---|---|---|
| Amplify | `npx ampx sandbox --once` | `amplify-amplifygen2withawsblockspoc-...-sandbox-7dadc39086`（+auth/data ネスト） | Cognito / AppSync / DynamoDB(Todo) | `amplify_outputs.json` |
| AWS Blocks | `npm run deploy:blocks` | `blocks-poc-stack-prod` | Lambda / API Gateway / DynamoDB(KVStore) | `.blocks-sandbox/config.json` |

### 🛑 ここで一旦停止 — 「二重デプロイの面倒」を体感する（＝一元化の動機）

実際にやってみて確認できた不便さ:

1. **デプロイが2コマンド**: 1回のリリースに `npx ampx sandbox` と `npm run deploy:blocks` の両方が必要。片方を忘れると本番が片肺で食い違う（drift）。
2. **スタックが2つ**: CloudFormation 上に無関係な2スタックが並ぶ。ライフサイクル（作成/更新/削除）を別々に管理する必要がある。
3. **設定ファイルが2系統**: フロントは `amplify_outputs.json`（Amplify）と `.blocks-sandbox/config.json`（Blocks）の**両方**を読む羽目になる。
4. **片付けも2コマンド**: `ampx sandbox delete` と `npm run destroy:blocks` を別々に叩く。

→ この「同じ1アプリなのに2系統」を解消するのが Phase 2 の目的。

---

## Phase 2 — Amplify へ一元化（AWS 認証必要）

### 手順 2-1: amplify/backend.ts に BlocksBackend を埋め込む

<!-- 差分をここに記録 -->

### 手順 2-2: --conditions=cdk 付きでデプロイ

<!-- コマンドと出力をここに記録 -->

### 手順 2-3: 🔴 mock 落ち判定（このPoCの核）

<!-- grep 結果を verbatim で記録 -->

---

## Phase 3 — 成功判定と片付け

### 成功チェックリスト

- [ ] `NODE_OPTIONS=--conditions=cdk npx ampx sandbox --once` が完走する
- [ ] synth 出力に building block の**実リソース（DynamoDB Table）**が出ている（mock 落ちしていない）
- [ ] `blocks.apiUrl` を叩くと**実レスポンス**が返る
- [ ] デプロイが **`ampx` 一発**で完結する

### 片付け

<!-- コマンドと出力をここに記録 -->

---

## 結論

<!-- 白黒ついた結論をここに記録 -->
