# 実行記録（続編）: Blocks 一本化バックエンドに Amplify ネイティブ Auth を"足す"

> 前回（`POC-NOTES.md`）は「バックエンドを全部 AWS Blocks に寄せ、デプロイを Amplify(`ampx`)に一元化」した。
> 本編はその**逆ベクトル**。キレイに一本化した構成の上に、**あえて Amplify ネイティブのリソース（Auth=Cognito）を1つ足す** hybrid を試す。
>
> **■ 記事の核（これ一点）**
> **`defineBackend({})`（空の器）に Amplify ネイティブの `defineAuth`(Cognito) を足し、それを Blocks 側が `AuthCognito.fromExisting()` で消費したとき、`BlocksBackend` と `auth` の間で循環参照にならずに完全統合できるか。**
>
> 循環さえ断てれば「Amplify ネイティブ resource と Blocks を、同一 `defineBackend` 内で完全統合できる」と言える。

## 採るかたち

| 項目 | 内容 |
|---|---|
| Cognito リソース | **Amplify `defineAuth`**（ネイティブ） |
| Blocks 側の消費 | `AuthCognito.fromExisting(poolId)`（リソースは作らず wrap して消費） |
| frontend の認証 UI/SDK | **Blocks `<Authenticator>` / `authApi`**（`aws-amplify` は使わない＝前回の"frontend 純 Blocks"を維持） |
| clientId | 省略（fromExisting が既存プール上に USER_PASSWORD_AUTH 対応 Client を自前生成） |

ゴールは「ログインが動き、API も認証必須」を **ローカル(mock) / Sandbox / 本番** の3環境すべてで成立させること。

## 循環参照の設計（核心リスクの扱い）

依存は **`blocks → auth` の一方向のみ**に保つ：

- blocks → auth（3本）: Lambda env に poolId / IAM を pool ARN にスコープ / 既存プール上に UserPoolClient を1個作成
- auth → blocks（0本）: **Cognito トリガー（pre-signup 等）を Blocks Lambda にひも付けない**。付けると auth→blocks の矢印ができ相互参照＝循環。
- モジュール循環の回避: poolId は `import` で取らず **値（`process.env.AMPLIFY_USER_POOL_ID`）で受け渡す**。`index.ts` が `amplify/backend.ts` を import し返すと `backend.ts→index.ts→backend.ts` の循環になるため。

→ 一方向なら nested stack 間で輪が閉じない（CDK synth が `Circular dependency` を投げない）はず。これを **synth で実証**するのが本編の "前回の mock 落ちチェック" に相当する関門。

---

## 実装ログ

### 手順 1: ブランチ作成
```bash
git checkout -b feat/amplify-native-auth
```

### 手順 2: Amplify ネイティブ Auth を追加
- `amplify/auth/resource.ts`（新規）: `defineAuth({ loginWith: { email: true } })`。**トリガーは付けない**（循環回避）。

### 手順 3: `amplify/backend.ts` を配線
- `defineBackend({})` → **`defineBackend({ auth })`**。
- `BlocksBackend.create()` の **前**に `process.env.AMPLIFY_USER_POOL_ID = backend.auth.resources.userPool.userPoolId`（値で受け渡し＝import 循環を断つ）。

### 手順 4: `aws-blocks/index.ts` で Cognito を消費
- `AuthCognito` を追加。`userPool: poolId ? AuthCognito.fromExisting(poolId) : undefined`
  （poolId 無し＝ローカル mock 時は自前プール → `npm run dev` は Amplify 非依存のまま）。
- `export const authApi = auth.createApi();`
- 認証必須メソッド `whoami()` を追加（`await auth.requireAuth(context)`）。
  → 「Amplify が発行した JWT を Blocks Lambda が requireAuth で検証」の end-to-end 証明点。

### 手順 5: 型検証（AWS 不要）
```bash
npm run typecheck   # → exit 0
```
`AuthCognito.fromExisting` → `requireAuth` → `user.userSub` まで型が通る。**オフラインで確認できる範囲は緑**。

---

## Step 0（循環の実証）— ✅ 完了（循環なし・完全統合を実機で実証）

**注意**: `ampx sandbox` は synth の前段で実 AWS（STS / SSM:GetParameter）を叩くため、**純オフライン synth は取れない**。expired creds は `InvalidCredentialError`、ダミー creds は `SSMCredentialsError` で停止する。実証には `aws login` が必須。

**実行**:
```bash
aws login
NODE_OPTIONS=--conditions=cdk npx ampx sandbox --once
# → ✔ Deployment completed in 192.826 seconds
```
- `Circular dependency` エラーは **一切なし**。CloudFormation がスタックを受理して CREATE_COMPLETE（CFN は循環を含むスタックを拒否するので、完走＝循環なしの一次証拠）。
- 出力: `auth.user_pool_id = ap-northeast-1_448nP6K4p` / `custom.blocksApiUrl = https://anthol3x59.execute-api.ap-northeast-1.amazonaws.com/prod/aws-blocks/api`

**実テンプレによる裏づけ（`.amplify/artifacts/cdk.out`）**:

1. **fromExisting が Amplify プールを実際に wrap した**（自前プール作成＝不発、ではない）
   - blocks ネストスタックに自前 `AWS::Cognito::UserPool` は **無し**。
   - `AWS::Cognito::UserPoolClient`（`blocksblockspocauthclient…`）のみ自前生成 ← clientId 省略の設計どおり、既存プール上にクライアントだけ作る。
   - Lambda env に `BLOCKS_AUTH_COGNITO_…_USER_POOL_ID / _CLIENT_ID / _REGION`。poolId のリテラルは blocks テンプレに**直接現れず**、CFN cross-stack 参照で解決。

2. **依存は `blocks → auth` 一方向**（root template）
   - `blocks` ネストスタック: Parameter `referenceto…authNestedStack…OutputsamplifyAuthUserPool…Ref` で **auth の poolId を受領**。
   - `auth` ネストスタック: 他スタック出力を受ける Parameter は **ゼロ**。
   - auth の Outputs は自身の UserPool / AppClient / IdentityPool の Ref のみ（blocks backend への参照なし。テンプレ内の "blocks" 文字列はプロジェクト名 `…withawsblocks…` のノイズ）。

→ **循環なしで Amplify ネイティブ Auth と Blocks が完全統合されることを実機デプロイで実証。** 君の見立て（「循環さえクリアできれば完全統合」）が成立。

**残（任意・本証明の上積み）**: Cognito にテストユーザーを作成 → サインインで JWT 取得 → `whoami` に渡して 200／未ログインで 401 を確認（= Amplify 発行トークンを Blocks Lambda が検証する end-to-end）。

---

## 現時点の結論

- **設計上 & 実機**: `blocks → auth` 一方向で循環しない（トリガー不使用＋env 受け渡しが要件）。**実証済み**。
- **fromExisting**: Amplify の既存 Cognito を Blocks が wrap して消費（自前プールを作らない）を実テンプレで確認。
- **実装**: Option A の最小スライス完成、typecheck 緑、ampx 一発デプロイ完走。
- 後始末: 検証が済んだら `npm run sandbox:amplify:delete`（`ampx sandbox delete`）でスタック破棄。

---

## 手順1 — 認証を「機能」にする（ログイン＋API 認証必須）

仮の `whoami` を捨て、**実際にログインでき、API も認証必須**にする。

### backend（`aws-blocks/index.ts`）
- `api` の全メソッド冒頭に `await auth.requireAuth(context)` を追加（Todo/メモを認証必須化）。
- `AuthCognito` に `crossDomain`（cross-domain Cookie の出し分け）を追加。
  - クラウド（Sandbox/本番）は frontend と API が別オリジン → セッション Cookie を `SameSite=None; Secure` に。ローカル mock は loopback なので `Lax`。
  - ⚠️ **当初 `crossDomain: !!amplifyUserPoolId` と書いたがこれはバグだった**（後述「Sandbox 検証で踏んだバグ」）。正しくは `backend.ts` が Lambda env に `BLOCKS_CROSS_DOMAIN='true'` を立て、`index.ts` が `process.env.BLOCKS_CROSS_DOMAIN === 'true'` を読む。

### frontend（`src/App.tsx`）
- `import { api, authApi } from 'aws-blocks'` ＋ `import { AccountMenuBar, onAuthChange } from '@aws-blocks/blocks/ui'`。
- `AccountMenuBar(authApi)` でサインイン/アカウントメニュー、`onAuthChange` でログイン状態購読。未ログイン時は機能を隠す。
  - ※ この時点では**公式 `AccountMenuBar`** を使用。後に **email 表示のため自前 `AccountBar` ＋ `Authenticator` モーダルに差し替え**た（→ 補足「落とし穴①②」）。
- **`aws-amplify` は不使用**（frontend は純 Blocks のまま）。

### ローカル（mock）検証 — ✅
```bash
npm run typecheck   # exit 0（backend+frontend）
npm run dev         # Vite:3000 + mock dev server:3001
```
- 未認証で API を叩く → **401 で拒否**（requireAuth が効く）:
  ```
  POST /aws-blocks/api {"jsonrpc":"2.0","method":"api.listTodos","params":[],"id":1}
  → {"error":{"code":401,"message":"Authentication required","name":"NotAuthenticatedException"}}
  ```
- 生成 `client.js` に `authApi` が出て、Vite が解決（ログイン UI が配線済み）。
- **確認コードの入手**: mock はメール送信が無いが、確認コードを**ディスクに永続している**（`.bb-data/blocks-poc-auth/last-code.json`、および `state.json` の `codes`）。なので元々ここから取得可能。
  - 加えて、ターミナルで見やすいよう **mock 限定の `codeDelivery` を追加**し `[back]` コンソールにも出力（`codeDelivery` は mock 専用オプションなので `amplifyUserPoolId` が無いローカル時だけ spread で付与）。これは利便目的の上乗せで、必須ではない。
  - ⚠️ 落とし穴: **既存メールで再 signUp すると `"User already exists"` で弾かれ新しいコードは出ない**。`.bb-data` に過去アカウントが残るため。クリーンにするなら `rm -rf .bb-data`（mock のローカル状態のみ・gitignore 済み）。
- **正のログイン往復もローカルで実証** ✅: `authApi.setAuthState`（`{action:'signUp'|'confirmSignUp'|'signIn'}`）で
  signUp → コードが console に出力（`🔑 [mock auth] … 497563`）→ confirmSignUp → signIn（`signedIn`・`userSub` 取得）→
  cookie 付きで `api.createTodo`/`api.listTodos` が **200**。未認証は **401**。

---

## 手順2 — Sandbox 検証で踏んだバグ（記事の山場）

`npm run sandbox:amplify:once` でデプロイ後、「**Cognito ログイン済みなのに API が 401**」になった。切り分けの記録：

### 切り分け（推測せず実測）
1. デプロイ済み API を未認証で叩く → 本文 `error.code:401`（**HTTPは200**＝JSON-RPC は transport 200・エラーは本文。これ自体は正常）。
2. 診断用 Cognito ユーザーを `admin-create-user`＋`admin-set-user-password` で作成 → `authApi.setAuthState{signIn}` → **`signedIn`**。
3. **その Set-Cookie を curl で付け替えて `api.listTodos` → 200＋データ**。→ **サーバ側の認証検証は正しい**。
4. Set-Cookie 属性を見ると **`SameSite=Lax`**。→ ブラウザは `localhost:3000`→別オリジン API に Lax cookie を送らない＝ログイン済みでも 401。
5. デプロイ済み Lambda の env を確認 → `AMPLIFY_USER_POOL_ID` は**無い**（`BLOCKS_CONFIG_*`/`CORS_ALLOWED_ORIGINS`/`BLOCKS_STACK_NAME`/`NODE_ENV` のみ）。

### 根本原因
`crossDomain: !!amplifyUserPoolId` の `amplifyUserPoolId = process.env.AMPLIFY_USER_POOL_ID` は **`backend.ts` が synth プロセスで set するだけ**。`index.ts` は **synth 時とランタイム(Lambda)の両方で読まれる**が、**ランタイムには `AMPLIFY_USER_POOL_ID` が無い** → `crossDomain` が常に `false` → `SameSite=Lax`。
（`userPool: fromExisting(...)` は synth 時評価なので poolId 有り→正しく wrap。だから「認証は通るのに Cookie だけ Lax」というチグハグが出た。）

> 教訓: **synth 時にしか無い値（`process.env` への代入）を、ランタイムで効く設定に使ってはいけない**。ランタイムに渡すなら `handler.addEnvironment(...)` で Lambda env にする。

### 修正
- `amplify/backend.ts`: `blocks.handler.addEnvironment('BLOCKS_CROSS_DOMAIN', 'true')`
- `aws-blocks/index.ts`: `crossDomain: process.env.BLOCKS_CROSS_DOMAIN === 'true'`

### デプロイ反映のハマり（おまけ）
修正後 `sandbox:amplify:once` が **「0.8秒・変更なし」**で何度も素通り（ampx が synth キャッシュを使い変更を拾わない）。**`rm -rf .amplify` で強制再 synth** したら反映（4.7秒の実更新）。

### 検証結果 — ✅
デプロイ後の実測:
- Set-Cookie が **`SameSite=None; Secure`** に変化。
- その cookie で `api.createTodo`→`listTodos` が **200＋データ**。未認証は **401**。
→ **サーバ/デプロイ側 修正完了**。さらに **ブラウザ `front:amplify`（`localhost:3000`・http）でも実ログイン → 認証付き Todo/メモが通ることを確認** ✅。localhost は secure context 扱いのため、`SameSite=None; Secure` の cross-site cookie が http localhost からでも実際に送られた（事前に懸念した localhost-http の癖は問題なし）。→ **Sandbox 検証 完了**。

### 次
- **本番（Amplify Hosting / HTTPS）** で同検証（cross-domain cookie が本番ドメインでも効くか）。
- ※ デプロイは課金・実リソース作成のため、実行前に都度確認する。

---

## 補足: 認証のアーキテクチャ差（Amplify ネイティブ ⇔ AWS Blocks）

同じ Cognito を使っても、**認証の"扱い方"が両者で根本的に違う**。今回の hybrid は IdP（User Pool）は
Amplify ネイティブ（`defineAuth`）だが、**認証ハンドリングは Blocks 方式**（`fromExisting` で wrap し、
frontend は Blocks `<Authenticator>`＝`aws-amplify` 不使用）。その含意を、今回**実測で裏取りした事実**ベースで整理する。

| 観点 | Amplify ネイティブ（AppSync / Amplify-JS） | AWS Blocks |
|---|---|---|
| 認可の実施層 | **AppSync の managed 層**（スキーマ宣言 `allow.owner()` / `allow.group()` 等） | **単一 Lambda 内**の `auth.requireAuth(context)`（コード） |
| API Gateway / エッジ | managed（AppSync が JWT を検証してエッジで弾く） | **API GW は `AuthorizationType: NONE`** → 全通し、Lambda が弾く |
| frontend のトークン | Cognito の **JWT をブラウザ保持**（localStorage/メモリ）、`Authorization: Bearer` で送信 | **保持しない**。**HttpOnly 不透明 session cookie** のみ（Cognito トークンはブラウザに届かない） |
| セッション失効 | JWT の期限依存（revoke しづらい） | **server 側 session ＝即時失効可** |
| 認可の粒度 | スキーマ宣言（owner / group 等） | **コードファースト**（メソッド毎に `requireAuth` / `requireRole`） |
| クロスオリジン | CORS のみ（Bearer はヘッダ） | CORS ＋ **Cookie の SameSite / cross-domain**（← 今回ハマった所） |
| セキュリティの綱引き | CSRF に強い / **XSS でトークン窃取に弱い**（localStorage） | **XSS でセッション窃取に強い**（HttpOnly）/ CSRF は SameSite で対処 |
| 未認証トラフィック | managed 層で弾く（Lambda 起動なし） | **Lambda を起動してから**弾く（その分課金・Lambda が唯一の関門） |

### このPoCで実測した具体（上表の裏づけ）
- **401 を返すのは Lambda**。API Gateway の各メソッドは `AuthorizationType: NONE` で全リクエストを単一 Lambda に素通しし、`requireAuth` で弾く（JSON-RPC なので **HTTP は 200・本文に `error.code:401`**）。
- セッションは **HttpOnly の不透明 cookie**（`auth_...=...; HttpOnly; SameSite=...`）。中身は server 側 SessionRecord へのポインタで、Cognito トークンは載らない。
- frontend と API が別オリジンになる Sandbox/本番では cookie を `SameSite=None; Secure`（cross-domain）にする必要があり、その出し分けが `crossDomain`。**synth 専用 env をランタイムで使うバグ**（上記「手順2」）も、この cookie 方式特有のハマりどころ。

### 使い分けの指針
- **managed なエッジ認可・宣言的な認可ルール（owner/group）・トークンをそのまま AppSync に渡す世界**が欲しい領域 → **Amplify ネイティブ（AppSync）に残す**。
- **コードで細かく認可制御したい・トークンをブラウザに置きたくない（HttpOnly cookie）・プロバイダ非依存**にしたい領域 → **Blocks**。
- hybrid なら、**領域ごとに両モデルを適材適所で混ぜられる**（今回は「IdP=Amplify / 認証ハンドリング=Blocks」という混ぜ方）。

### 落とし穴①: 表示名が mock=email / Cognito=UUID になる
- `AccountMenuBar` は **`user.username` を表示**する。
- **Cognito（Amplify プール）の username は UUID**。Amplify の `defineAuth({loginWith:{email:true}})` は
  synth テンプレ上 `UsernameAttributes:['email']` / `AliasAttributes:None`（email サインイン）でプールを作るが、
  **Cognito はこのモードでは内部 Username を必ず自動生成 UUID にする**仕様（email はサインイン属性であって Username ではない）。
  → `getCurrentUser().username` は UUID。
  - ⚠️ よって「プールを email-as-username 化して公式バーで揃える」案は **不可能**（Cognito 仕様上 username を email にできない）。
- 一方 **mock は username=email**（Blocks の mock は Cognito の UUID-username 挙動を再現せず、サインアップ email を username に使う）＝ mock と実 Cognito の parity ギャップ。
- 対処: **UI で `user.attributes.email` を表示**（email は mock/Cognito 双方の user に存在）。username は表示に使わない。

### 落とし穴②: Blocks 認証 UI のカスタマイズ性が低い（記事メモ）
表示名を email にしようとして判明した、auth UI（`@aws-blocks/*/ui`）の設計上の制約。記事の "正直な評価" として残す：
- **`AccountMenuBar(api)` は引数が `api` のみ**。表示フィールド（`user.username` 固定）やラベルを差し替えるオプションが無く、email 表示にできない。
- **auth 状態キャッシュ（`cache.state`）と更新関数 `updateState` が非 export**（公開 API は `onAuthChange` / `broadcastAuthChange` / `Authenticator` / `AccountMenuBar` / `AuthenticatedContent` のみ）。
  - そのため「**表示だけ自前・状態管理は公式**」という部分カスタムが成立しない：自前サインアウトは `cache.state` を更新できず（`broadcastAuthChange` は listener 通知のみで cache 不変、`ensureState` は `if(cache.state) return` で短絡）、結果 公式 `Authenticator` が古い状態を読んで**ログアウト後も「Signed in as …」を描画**する不具合になる。
- 実質 **all-or-nothing**：公式コンポーネントをそのまま使う（表示の自由度は低い）か、状態機械ごと自前で作り直すか。「公式の状態管理を再利用しつつ表示だけ変える」公開フックが無い。
- 現実解: 自前バー＋**サインアウト時にページ reload**（cache をリセット）で状態破綻を断つ。
  → 本 PoC ではこれを採用（Option 3）。email 表示・サインアウト→再サインインを **mock / sandbox 両方で確認済み** ✅。
