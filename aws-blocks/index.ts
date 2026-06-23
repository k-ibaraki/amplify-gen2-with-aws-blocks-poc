/**
 * AWS Blocks バックエンド本体（PoC 用）。
 *
 * このアプリは「2つのバックエンド」を持つ Web アプリの **Blocks 側**を担当する。
 *   - Amplify 側 : Todo リスト（AppSync + DynamoDB / amplify/data）
 *   - Blocks 側  : 共有メモ（このファイル。KVStore = DynamoDB 1テーブル）
 *
 * frontend は Phase 1 では両方に別々のクライアントでアクセスする（＝二重で面倒）。
 * Phase 2 では Amplify 側の Todo もこの Blocks に寄せ、デプロイを Amplify に一元化する。
 *
 * このファイルは2つのデプロイ経路で共有される：
 *   - ローカル/単独デプロイ : index.cdk.ts（BlocksStack）
 *   - Amplify 一元化         : amplify/backend.ts の BlocksBackend.create()
 */
import { ApiNamespace, Scope, KVStore } from '@aws-blocks/blocks';

const scope = new Scope('blocks-poc');

// 共有メモを保存する KVStore（DynamoDB テーブル1個）。
// --conditions=cdk が building block まで伝播すれば実テーブルが synth に出る。
// 伝播しなければ mock に落ちて消える ＝ Phase 2 の mock 落ち判定の決め手。
const store = new KVStore(scope, 'store', { removalPolicy: 'destroy' });

const NOTE_KEY = 'shared-note';

// データメソッド（get/put）はリクエスト時に実行する必要があるため、
// トップレベルではなく ApiNamespace のメソッド内で呼ぶ。認証なし（public）。
export const api = new ApiNamespace(scope, 'api', (context) => ({
  /** 共有メモを取得する。未保存なら空文字。 */
  async loadNote() {
    const text = await store.get(NOTE_KEY);
    return { text: (text as string | null) ?? '' };
  },
  /** 共有メモを保存する。 */
  async saveNote(text: string) {
    await store.put(NOTE_KEY, text);
    return { ok: true };
  },
}));
