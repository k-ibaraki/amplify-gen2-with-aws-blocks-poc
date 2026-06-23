/**
 * ローカルの Vite フロントを「Amplify(ampx) でデプロイした Blocks バックエンド」に
 * 繋ぐための設定スクリプト。
 *
 * amplify_outputs.json の custom.blocksApiUrl を読み、Blocks クライアントが参照する
 * .blocks-sandbox/config.json にその URL を書き込む。これにより `vite` を起動すると
 * ブラウザが ampx デプロイ済みの API Gateway を直接叩く（CORS は backend 側で許可済み）。
 *
 * 使い方: `npm run dev:amplify`（= このスクリプト → vite）
 * 前提: 先に `npm run amplify:sandbox` で backend をデプロイ済みであること。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const outputs = JSON.parse(readFileSync('amplify_outputs.json', 'utf-8'));
const apiUrl: string | undefined = outputs?.custom?.blocksApiUrl;

if (!apiUrl) {
  console.error(
    '[dev:amplify] amplify_outputs.json に custom.blocksApiUrl がありません。\n' +
    '  先に `npm run amplify:sandbox` で backend をデプロイしてください。',
  );
  process.exit(1);
}

mkdirSync('.blocks-sandbox', { recursive: true });
writeFileSync(
  '.blocks-sandbox/config.json',
  JSON.stringify({ apiUrl, environment: 'amplify' }, null, 2),
);

console.log('[dev:amplify] Blocks client → ' + apiUrl);
console.log('[dev:amplify] このあと vite が起動します。http://localhost:3000 を開いてください。');
