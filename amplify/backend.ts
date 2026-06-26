import { defineBackend } from '@aws-amplify/backend';
import { BlocksBackend } from '@aws-blocks/blocks/cdk';
import { RemovalPolicies } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auth } from './auth/resource';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Phase 3（続編）: バックエンドの定義は引き続き AWS Blocks 側（aws-blocks/index.ts）に
 * 一本化したまま、**Amplify ネイティブの Auth（Cognito）だけを"足す"** hybrid。
 *
 * Cognito リソースは Amplify(`defineAuth`)が持ち、Blocks 側はそれを
 * `AuthCognito.fromExisting(poolId)` で **消費するだけ**（リソースは作らない）。
 *
 * ■ 循環参照について（今回の核心リスク）
 *   依存は **blocks → auth の一方向のみ**:
 *     - Blocks Lambda の env に poolId を渡す / IAM を pool ARN にスコープ /
 *       既存プール上に UserPoolClient を1個作る … いずれも blocks→auth。
 *     - auth(Cognito) 側は blocks の出力を一切参照しない（トリガー不使用）。
 *   → 一方向なので nested stack 間で輪が閉じない。
 *
 *   なお poolId は **import ではなく値(env)で受け渡す**。index.ts が
 *   `amplify/backend.ts` を import し返すと backend.ts→index.ts→backend.ts の
 *   モジュール循環になるため、それを設計で断つ。
 */
const backend = defineBackend({ auth });

// poolId を「値」として env に渡す（await import の前に同期的にセット）。
// → index.ts は process.env から読むだけ。import 循環を作らない。
process.env.AMPLIFY_USER_POOL_ID = backend.auth.resources.userPool.userPoolId;

// BlocksBackend は Construct。fullId が Amplify Gen2 の createStack('blocks') を想定済み。
const blocksStack = backend.createStack('blocks');
const blocks = await BlocksBackend.create(blocksStack, 'blocks', {
  backendHandlerPath: join(__dirname, '../aws-blocks/index.handler.ts'),
  backendCDKPath: join(__dirname, '../aws-blocks/index.ts'), // ★本体を共有
});

// PoC: 後始末しやすいよう全リソースを削除可能に
RemovalPolicies.of(blocksStack).destroy();

// CORS をすべて許可（PoC のため。本番は Amplify Hosting のドメインに絞る）
blocks.handler.addEnvironment('CORS_ALLOWED_ORIGINS', '.*');

// クラウドは frontend と API が別オリジン → セッション Cookie を cross-domain
// （SameSite=None; Secure）にする。crossDomain は **ランタイム**で効くので、synth 専用の
// AMPLIFY_USER_POOL_ID ではなく Lambda の環境変数として渡す（index.ts が読む）。
blocks.handler.addEnvironment('BLOCKS_CROSS_DOMAIN', 'true');

// frontend に Blocks API の URL を渡す（amplify_outputs.json の custom.blocksApiUrl に出る）
backend.addOutput({ custom: { blocksApiUrl: blocks.apiUrl } });
