/**
 * AWS Blocks バックエンド本体（Phase 2: バックエンドを Blocks に一本化）。
 *
 * Phase 1 では Todo を Amplify ネイティブ（AppSync/DynamoDB）、共有メモを Blocks で
 * 持っていたが、Phase 2 では **両方を Blocks に寄せる**。これでバックエンドの定義は
 * すべてこのファイルに集約され、デプロイだけ Amplify(ampx) に一元化できる。
 *
 *   - Todo     : DistributedTable（DynamoDB）。一覧/追加/削除
 *   - 共有メモ : KVStore（DynamoDB 1テーブル）。保存/読込
 *
 * frontend は `import { api } from 'aws-blocks'` の **1クライアント**で両方を呼ぶ。
 *
 * このファイルは2つの経路から読み込まれる（バックエンド定義はここに一本化）：
 *   - ローカル開発 : aws-blocks/scripts/server.ts（mock dev server）
 *   - デプロイ     : amplify/backend.ts の BlocksBackend.create()（ampx 経由）
 */
import { ApiNamespace, Scope, KVStore, DistributedTable, AuthCognito } from '@aws-blocks/blocks';
import { z } from 'zod';

const scope = new Scope('blocks-poc');

// ─── Auth（Amplify ネイティブ Cognito を Blocks が消費）──────────────────────
// 続編の主題: Cognito リソースは Amplify(defineAuth)が持ち、Blocks はそれを
// fromExisting で wrap して「消費」するだけ（自前プールは作らない）。
//
//   - ampx デプロイ時 : amplify/backend.ts が AMPLIFY_USER_POOL_ID(env) をセット
//                       → fromExisting(poolId) で Amplify の既存プールを wrap。
//   - ローカル dev(mock): env が無い → userPool 未指定 → Blocks が自前プールを
//                       mock で立てる。よって `npm run dev` は Amplify 非依存のまま。
//
// clientId は省略する。fromExisting は clientId 省略時に既存プール上へ
// USER_PASSWORD_AUTH 対応の UserPoolClient を自前生成するので、Amplify 既定
// クライアントの認証フロー非互換を踏まない。
const amplifyUserPoolId = process.env.AMPLIFY_USER_POOL_ID;
const auth = new AuthCognito(scope, 'auth', {
  signInWith: 'email',
  userPool: amplifyUserPoolId ? AuthCognito.fromExisting(amplifyUserPoolId) : undefined,
  // クラウド（Sandbox/本番）では frontend と API が別オリジンになるため、
  // セッション Cookie を SameSite=None; Secure（cross-domain）にする必要がある。
  // ⚠️ crossDomain は **Lambda ランタイムで評価**される。AMPLIFY_USER_POOL_ID は
  //    synth 専用（backend.ts が synth プロセスで set するだけ）でランタイムには無いので
  //    ここでは使えない。backend.ts が Lambda env に立てる BLOCKS_CROSS_DOMAIN を読む。
  //    ローカル mock dev は未設定 → false（loopback なので Lax で可）。
  crossDomain: process.env.BLOCKS_CROSS_DOMAIN === 'true',
  // ローカル mock 限定: mock にはメール送信が無いため、確認コードは `codeDelivery`
  // を渡さないと握り潰される。dev サーバ(`npm run dev` の [back]) のコンソールに出す。
  // codeDelivery は mock 専用オプション（クラウドは実 Cognito がメール送信するので不要）。
  ...(amplifyUserPoolId
    ? {}
    : {
        codeDelivery: async (username: string, code: string, purpose: string) => {
          console.log(`\n🔑 [mock auth] ${purpose} の確認コード（${username}）: ${code}\n`);
        },
      }),
});

// <Authenticator> UI を駆動する状態機械 API（frontend は authApi で呼ぶ）。
export const authApi = auth.createApi();

// ─── Todo（DistributedTable = DynamoDB）─────────────────────────────────────
// 認証必須の共有 Todo リスト（全 API で requireAuth）。全件を固定パーティション 'todo' に入れて query で一覧する。
const todoSchema = z.object({
  pk: z.string(),        // 固定パーティションキー（'todo'）
  id: z.string(),        // ソートキー（作成時刻ベースの一意ID）
  content: z.string(),
  createdAt: z.number(),
});
const todos = new DistributedTable(scope, 'todos', {
  schema: todoSchema,
  key: { partitionKey: 'pk', sortKey: 'id' },
});
const TODO_PK = 'todo';

// ─── 共有メモ（KVStore = DynamoDB）──────────────────────────────────────────
const store = new KVStore(scope, 'store', { removalPolicy: 'destroy' });
const NOTE_KEY = 'shared-note';

// データメソッドはリクエスト時に実行する必要があるため ApiNamespace 内で呼ぶ。
// 全メソッド冒頭で `auth.requireAuth(context)` を呼び、認証必須にする。
// → Amplify が発行した Cognito の JWT を Blocks の Lambda が検証する（cloud 時）。
//   Cognito トリガーは使わず request 時に検証する（auth→blocks の矢印を作らない＝循環回避）。
export const api = new ApiNamespace(scope, 'api', (context) => ({
  // --- Todo ---
  async listTodos() {
    await auth.requireAuth(context);
    return await Array.fromAsync(
      todos.query({ where: { pk: { equals: TODO_PK } } }),
    );
  },
  async createTodo(content: string) {
    await auth.requireAuth(context);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await todos.put({ pk: TODO_PK, id, content, createdAt: Date.now() });
    return { ok: true, id };
  },
  async deleteTodo(id: string) {
    await auth.requireAuth(context);
    await todos.delete({ pk: TODO_PK, id });
    return { ok: true };
  },

  // --- 共有メモ ---
  async loadNote() {
    await auth.requireAuth(context);
    const text = await store.get(NOTE_KEY);
    return { text: (text as string | null) ?? '' };
  },
  async saveNote(text: string) {
    await auth.requireAuth(context);
    await store.put(NOTE_KEY, text);
    return { ok: true };
  },
}));
