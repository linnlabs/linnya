import type { ProviderAccountOAuthCredential } from '../../../definitions/providerAccount';
import { CHATGPT_OAUTH_CONFIG, type ChatGptOAuthTokenClient } from '../definitions/chatGptOAuth';
import { readChatGptOAuthTokenResponse } from '../functions/readChatGptOAuthTokenResponse';

async function postTokenRequest(
  fetchImplementation: typeof fetch,
  body: URLSearchParams
): Promise<unknown> {
  const response = await fetchImplementation(CHATGPT_OAUTH_CONFIG.token_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(CHATGPT_OAUTH_CONFIG.token_http_timeout_ms),
  });
  if (!response.ok) {
    // Provider 原始正文可能含账户信息，不进入 Host 错误、日志或 Renderer。
    throw new Error(`ChatGPT OAuth token endpoint 返回 HTTP ${response.status}`);
  }
  return response.json();
}

export function createChatGptOAuthTokenClient(
  fetchImplementation: typeof fetch = fetch,
  now: () => number = Date.now
): ChatGptOAuthTokenClient {
  return {
    async exchangeAuthorizationCode(code, codeVerifier) {
      const value = await postTokenRequest(
        fetchImplementation,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CHATGPT_OAUTH_CONFIG.client_id,
          code,
          redirect_uri: CHATGPT_OAUTH_CONFIG.redirect_uri,
          code_verifier: codeVerifier,
        })
      );
      return readChatGptOAuthTokenResponse(value, now());
    },
    async refreshCredential(credential: ProviderAccountOAuthCredential) {
      const value = await postTokenRequest(
        fetchImplementation,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CHATGPT_OAUTH_CONFIG.client_id,
          refresh_token: credential.refresh_token,
        })
      );
      return readChatGptOAuthTokenResponse(value, now(), credential);
    },
  };
}
