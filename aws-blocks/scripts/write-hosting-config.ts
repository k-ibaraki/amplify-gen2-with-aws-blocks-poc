/**
 * Amplify Hosting でフロントを配信する際、ビルド成果物 `dist/` の中に
 * `.blocks-sandbox/config.json` を置く。ブラウザの Blocks クライアントは
 * ホスティング配下の `/.blocks-sandbox/config.json` を読んで API URL を解決するため。
 *
 * API URL は backend デプロイ（ampx pipeline-deploy）が生成した
 * `amplify_outputs.json` の `custom.blocksApiUrl` から取る。
 *
 * 使い方（amplify.yml の frontend ビルドで `npm run build` の後に実行）:
 *   npx tsx aws-blocks/scripts/write-hosting-config.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const outputs = JSON.parse(readFileSync('amplify_outputs.json', 'utf-8'));
const apiUrl: string | undefined = outputs?.custom?.blocksApiUrl;

if (!apiUrl) {
  console.error('[hosting] amplify_outputs.json に custom.blocksApiUrl がありません（backend デプロイが先に必要）。');
  process.exit(1);
}

mkdirSync('dist/.blocks-sandbox', { recursive: true });
writeFileSync(
  'dist/.blocks-sandbox/config.json',
  JSON.stringify({ apiUrl, environment: 'production' }, null, 2),
);

console.log('[hosting] dist/.blocks-sandbox/config.json →', apiUrl);
