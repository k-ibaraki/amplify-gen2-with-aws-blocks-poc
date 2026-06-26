import { defineAuth } from '@aws-amplify/backend';

/**
 * Amplify ネイティブの認証リソース（Cognito User Pool）。
 *
 * 今回の主題（前回記事の続編）:
 *   前回は「バックエンドを全部 Blocks に寄せて Amplify はデプロイの器」だった。
 *   今回はその上に **あえて Amplify ネイティブのリソース（Auth=Cognito）を足す** hybrid。
 *   この Cognito を Blocks 側が `AuthCognito.fromExisting(poolId)` で消費する。
 *
 * 循環参照を避けるため、ここでは **トリガー（pre-signup 等）を一切付けない**。
 * トリガーを Blocks の Lambda に向けると auth→blocks の矢印が生まれ、
 * blocks→auth（poolId 参照）と合わせて相互参照＝循環になるため。
 */
export const auth = defineAuth({
  loginWith: { email: true },
});
