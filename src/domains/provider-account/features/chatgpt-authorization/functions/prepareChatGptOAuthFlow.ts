import { createHash, randomBytes } from 'node:crypto';

import { CHATGPT_OAUTH_CONFIG, type PreparedChatGptOAuthFlow } from '../definitions/chatGptOAuth';

/** 从 Craft 的 PKCE 参数集合移植；Linnya 只拥有生成与编排，不修改授权协议。 */
export function prepareChatGptOAuthFlow(): PreparedChatGptOAuthFlow {
  const state = randomBytes(32).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const query = new URLSearchParams({
    client_id: CHATGPT_OAUTH_CONFIG.client_id,
    response_type: 'code',
    redirect_uri: CHATGPT_OAUTH_CONFIG.redirect_uri,
    scope: CHATGPT_OAUTH_CONFIG.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    originator: 'linnya',
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
  });
  return {
    authorization_url: `${CHATGPT_OAUTH_CONFIG.authorization_url}?${query.toString()}`,
    state,
    code_verifier: codeVerifier,
  };
}
