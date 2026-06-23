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
 * このファイルは2つのデプロイ経路で共有される：
 *   - ローカル/単独    : index.cdk.ts（BlocksStack）
 *   - Amplify 一元化   : amplify/backend.ts の BlocksBackend.create()
 */
import { ApiNamespace, Scope, KVStore, DistributedTable } from '@aws-blocks/blocks';
import { z } from 'zod';

const scope = new Scope('blocks-poc');

// ─── Todo（DistributedTable = DynamoDB）─────────────────────────────────────
// 認証なしの共有 Todo リスト。全件を固定パーティション 'todo' に入れて query で一覧する。
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

// データメソッドはリクエスト時に実行する必要があるため ApiNamespace 内で呼ぶ。認証なし。
export const api = new ApiNamespace(scope, 'api', (context) => ({
  // --- Todo ---
  async listTodos() {
    return await Array.fromAsync(
      todos.query({ where: { pk: { equals: TODO_PK } } }),
    );
  },
  async createTodo(content: string) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await todos.put({ pk: TODO_PK, id, content, createdAt: Date.now() });
    return { ok: true, id };
  },
  async deleteTodo(id: string) {
    await todos.delete({ pk: TODO_PK, id });
    return { ok: true };
  },

  // --- 共有メモ ---
  async loadNote() {
    const text = await store.get(NOTE_KEY);
    return { text: (text as string | null) ?? '' };
  },
  async saveNote(text: string) {
    await store.put(NOTE_KEY, text);
    return { ok: true };
  },
}));
