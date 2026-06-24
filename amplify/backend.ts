import { defineBackend } from '@aws-amplify/backend';
import { BlocksBackend } from '@aws-blocks/blocks/cdk';
import { RemovalPolicies } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Phase 2: バックエンドの定義は全て AWS Blocks 側（aws-blocks/index.ts）にある。
 * Amplify は「デプロイの器」として使うだけなので defineBackend は空にし、
 * Amplify が作るスタックの中に AWS Blocks のバックエンドを埋め込む。
 *
 * これにより `ampx` 一発で AWS Blocks のリソース（Lambda/API GW/DynamoDB）が
 * デプロイされる。AWS Blocks 単体の cdk deploy 経路は不要になる。
 */
const backend = defineBackend({});

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

// frontend に Blocks API の URL を渡す（amplify_outputs.json の custom.blocksApiUrl に出る）
backend.addOutput({ custom: { blocksApiUrl: blocks.apiUrl } });
