/**
 * aws-blocks/client.js（frontend が import する型付きクライアント）を生成する。
 *
 * 通常はローカルの dev server が起動時に生成するが、CI（Amplify Hosting のビルド）では
 * dev server を起動しないので、`npm run build` の前段でこのスクリプトを明示的に走らせる。
 *
 * 実行は `--conditions=aws-runtime` 付きで（building block を runtime 解決させるため）:
 *   node --conditions=aws-runtime --import tsx aws-blocks/scripts/generate-client.ts
 */
import { writeClientCode } from '@aws-blocks/blocks/scripts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await writeClientCode(
  join(__dirname, '..', 'index.ts'),
  join(__dirname, '..', 'client.js'),
);

console.log('[generate:client] aws-blocks/client.js を生成しました');
