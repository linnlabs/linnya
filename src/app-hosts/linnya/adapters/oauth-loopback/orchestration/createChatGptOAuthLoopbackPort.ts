import { createServer, type Server } from 'node:http';

import { CHATGPT_OAUTH_CONFIG } from 'src/domains/provider-account';
import type {
  OAuthLoopbackCallback,
  OAuthLoopbackPort,
} from 'src/app-hosts/linnya/application/provider-account-authorization';

class OAuthCallbackTimeoutError extends Error {
  constructor() {
    super('OAuth callback timed out');
    this.name = 'OAuthCallbackTimeoutError';
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    server.closeAllConnections();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
    // 浏览器会复用 localhost HTTP 连接。只调用 server.close() 会停止监听，却会继续
    // 等待已有 keep-alive socket，进而把已经成功的 OAuth 请求永久卡在清理阶段。
    server.closeAllConnections();
  });
}

function callbackPage(success: boolean): string {
  const title = success ? '授权完成' : '授权失败';
  const detail = success ? '可以关闭此页面并返回 Linnya。' : '请返回 Linnya 后重新尝试。';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

export function createChatGptOAuthLoopbackPort(): OAuthLoopbackPort {
  return {
    async listen(input): Promise<OAuthLoopbackCallback> {
      let settleAuthorization: ((code: string) => void) | null = null;
      let rejectAuthorization: ((error: Error) => void) | null = null;
      const authorizationCode = new Promise<string>((resolve, reject) => {
        settleAuthorization = resolve;
        rejectAuthorization = reject;
      });
      const server = createServer((request, response) => {
        const url = new URL(
          request.url ?? '/',
          `http://${CHATGPT_OAUTH_CONFIG.callback_host}:${CHATGPT_OAUTH_CONFIG.callback_port}`
        );
        if (url.pathname !== CHATGPT_OAUTH_CONFIG.callback_path) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const authorized = Boolean(code) && state === input.expected_state;
        response.writeHead(authorized ? 200 : 400, {
          'content-type': 'text/html; charset=utf-8',
          // OAuth 回调页是一次性响应，不允许浏览器把连接留给授权 workflow 收尾。
          connection: 'close',
        });
        response.once('finish', () => {
          if (authorized && code) {
            settleAuthorization?.(code);
          } else {
            rejectAuthorization?.(new Error('OAuth callback was rejected'));
          }
        });
        response.end(callbackPage(authorized));
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(
          CHATGPT_OAUTH_CONFIG.callback_port,
          CHATGPT_OAUTH_CONFIG.callback_host,
          () => {
            server.removeListener('error', reject);
            resolve();
          }
        );
      });
      const timer = setTimeout(() => {
        rejectAuthorization?.(new OAuthCallbackTimeoutError());
      }, input.timeout_ms);
      timer.unref?.();
      return {
        authorization_code: authorizationCode,
        async close() {
          clearTimeout(timer);
          await closeServer(server);
        },
      };
    },
  };
}
