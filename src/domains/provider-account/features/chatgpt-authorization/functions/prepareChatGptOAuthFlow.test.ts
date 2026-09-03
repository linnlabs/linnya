import { describe, expect, it } from 'vitest';

import { CHATGPT_OAUTH_CONFIG } from '../definitions/chatGptOAuth';
import { prepareChatGptOAuthFlow } from './prepareChatGptOAuthFlow';

describe('ChatGPT OAuth authorization contract', () => {
  it('授权 URL 与后续 Codex 请求使用同一个 Linnya originator', () => {
    const flow = prepareChatGptOAuthFlow();
    const authorizationUrl = new URL(flow.authorization_url);

    expect(authorizationUrl.origin).toBe(new URL(CHATGPT_OAUTH_CONFIG.authorization_url).origin);
    expect(authorizationUrl.searchParams.get('originator')).toBe('linnya');
    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
