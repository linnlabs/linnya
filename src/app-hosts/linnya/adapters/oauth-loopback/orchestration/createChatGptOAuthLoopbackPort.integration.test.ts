import { connect, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { CHATGPT_OAUTH_CONFIG } from 'src/domains/provider-account';
import { createChatGptOAuthLoopbackPort } from './createChatGptOAuthLoopbackPort';

function openIdleConnection(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(CHATGPT_OAUTH_CONFIG.callback_port, CHATGPT_OAUTH_CONFIG.callback_host);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

describe.sequential('ChatGPT OAuth loopback lifecycle', () => {
  let idleConnection: Socket | undefined;

  afterEach(() => {
    idleConnection?.destroy();
    idleConnection = undefined;
  });

  it('回调成功后会主动结束浏览器遗留连接，不阻塞授权完成', async () => {
    const loopback = createChatGptOAuthLoopbackPort();
    const callback = await loopback.listen({
      expected_state: 'expected-state',
      timeout_ms: 5_000,
    });
    idleConnection = await openIdleConnection();

    const response = await fetch(
      `${CHATGPT_OAUTH_CONFIG.redirect_uri}?code=authorization-code&state=expected-state`
    );

    await expect(callback.authorization_code).resolves.toBe('authorization-code');
    expect(response.status).toBe(200);
    expect(response.headers.get('connection')).toBe('close');
    await expect(callback.close()).resolves.toBeUndefined();
    await new Promise<void>(resolve => {
      if (idleConnection?.destroyed) {
        resolve();
        return;
      }
      idleConnection?.once('close', () => resolve());
    });
  });
});
