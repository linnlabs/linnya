import type { ProviderAccountOAuthCredential } from '../../../definitions/providerAccount';

/**
 * 从 Craft Agents OSS 50ffa143 移植并按 Linnya 边界修改，Apache-2.0。
 * 这些值属于 Codex 公共客户端授权合同，不是 Linnya 自建 OAuth 应用配置。
 */
export const CHATGPT_OAUTH_CONFIG = {
  client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorization_url: 'https://auth.openai.com/oauth/authorize',
  token_url: 'https://auth.openai.com/oauth/token',
  redirect_uri: 'http://localhost:1455/auth/callback',
  callback_host: 'localhost',
  callback_port: 1455,
  callback_path: '/auth/callback',
  scopes: 'openid profile email offline_access',
  callback_timeout_ms: 5 * 60 * 1000,
  token_http_timeout_ms: 30 * 1000,
  refresh_buffer_ms: 5 * 60 * 1000,
} as const;

export interface PreparedChatGptOAuthFlow {
  readonly authorization_url: string;
  readonly state: string;
  readonly code_verifier: string;
}

export interface ChatGptOAuthTokenClient {
  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string
  ): Promise<ProviderAccountOAuthCredential>;
  refreshCredential(
    credential: ProviderAccountOAuthCredential
  ): Promise<ProviderAccountOAuthCredential>;
}
