/**
 * AWS Blocks バックエンド本体（PoC 用・最小構成）。
 *
 * このPoCの検証主役は「KVStore が mock にフォールバックせず、実体（DynamoDB
 * テーブル）として synth に出るか」の一点。機能は意図的に最小で、文字列を
 * put / get できるだけの key-value API にしている。
 *
 * このファイルは2つのデプロイ経路で共有される：
 *   - ローカル/単独デプロイ : index.cdk.ts（BlocksStack）から読まれる
 *   - Amplify 一元化         : amplify/backend.ts の BlocksBackend.create() から読まれる
 */
import { ApiNamespace, Scope, KVStore } from '@aws-blocks/blocks';

const scope = new Scope('blocks-poc');

// KVStore = DynamoDB テーブル1個。--conditions=cdk が building block まで伝播すれば
// 実テーブルが CloudFormation テンプレートに出る。伝播しなければ mock に落ちて消える
// ＝ これが Phase 2 の mock 落ち判定の決め手になる。
// removalPolicy: 'destroy' は PoC 後のテーブル削除を容易にするため。
const store = new KVStore(scope, 'store', { removalPolicy: 'destroy' });

// KVStore のデータメソッド（get/put）はリクエスト時に実行する必要があるため、
// トップレベルではなく ApiNamespace のメソッド内で呼ぶ。
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async set(key: string, value: string) {
    await store.put(key, value);
    return { ok: true };
  },
  async get(key: string) {
    return { value: await store.get(key) };
  },
}));
