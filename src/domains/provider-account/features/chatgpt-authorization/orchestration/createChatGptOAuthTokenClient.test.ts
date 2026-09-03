import { describe, expect, it, vi } from 'vitest';

import { CHATGPT_OAUTH_CONFIG } from '../definitions/chatGptOAuth';
import { createChatGptOAuthTokenClient } from './createChatGptOAuthTokenClient';

function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;
}

describe('ChatGPT OAuth token client', () => {
  it('使用 Craft 的 PKCE token wire，并从 JWT 建立账号身份与刷新生命周期', async () => {
    const requests: Array<{ readonly url: string; readonly body: URLSearchParams }> = [];
    let round = 0;
    const fetchImplementation: typeof fetch = vi.fn(async (input, init) => {
      requests.push({
        url: String(input),
        body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      });
      round += 1;
      return Response.json(
        round === 1
          ? {
              access_token: jwt({
                'https://api.openai.com/auth': { chatgpt_account_id: 'account-1' },
              }),
              refresh_token: 'refresh-1',
              id_token: jwt({ email: 'user@example.com' }),
              expires_in: 3600,
            }
          : {
              access_token: jwt({ chatgpt_account_id: 'account-1' }),
              refresh_token: 'refresh-2',
              expires_in: 7200,
            }
      );
    });
    const client = createChatGptOAuthTokenClient(fetchImplementation, () => 1_000_000);

    const initial = await client.exchangeAuthorizationCode('authorization-code', 'verifier');
    const refreshed = await client.refreshCredential(initial);

    expect(requests.map(request => request.url)).toEqual([
      CHATGPT_OAUTH_CONFIG.token_url,
      CHATGPT_OAUTH_CONFIG.token_url,
    ]);
    expect(Object.fromEntries(requests[0]?.body)).toEqual({
      grant_type: 'authorization_code',
      client_id: CHATGPT_OAUTH_CONFIG.client_id,
      code: 'authorization-code',
      redirect_uri: CHATGPT_OAUTH_CONFIG.redirect_uri,
      code_verifier: 'verifier',
    });
    expect(initial).toMatchObject({
      refresh_token: 'refresh-1',
      expires_at: 4_600_000,
      account_id: 'account-1',
      email: 'user@example.com',
    });
    expect(Object.fromEntries(requests[1]?.body)).toEqual({
      grant_type: 'refresh_token',
      client_id: CHATGPT_OAUTH_CONFIG.client_id,
      refresh_token: 'refresh-1',
    });
    expect(refreshed).toMatchObject({
      refresh_token: 'refresh-2',
      expires_at: 8_200_000,
      account_id: 'account-1',
      email: 'user@example.com',
    });
  });
});
