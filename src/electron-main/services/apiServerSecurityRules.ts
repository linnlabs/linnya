import { CONVERSATION_CONTROL_BRIDGE_PATH } from '@app/schemas';

export const API_SERVER_BIND_HOST = '127.0.0.1';

const API_CORS_EXACT_ORIGINS = new Set([
  'file://',
  'null',
]);

const API_CORS_PROTOCOLS = new Set([
  'app:',
  'vscode-webview:',
]);

export type ApiCorsOriginCallback = (err: Error | null, origin?: boolean) => void;

export function isAllowedApiCorsOrigin(origin: string | undefined, rendererOrigin?: string): boolean {
  if (origin === undefined) {
    return true;
  }

  if (API_CORS_EXACT_ORIGINS.has(origin)) {
    return true;
  }
  if (rendererOrigin !== undefined && origin === rendererOrigin) return true;

  try {
    const parsedOrigin = new URL(origin);
    return API_CORS_PROTOCOLS.has(parsedOrigin.protocol);
  } catch {
    return false;
  }
}

export function resolveApiCorsOrigin(
  origin: string | undefined, callback: ApiCorsOriginCallback, rendererOrigin?: string,
): void {
  callback(null, isAllowedApiCorsOrigin(origin, rendererOrigin));
}

/** CLI token 只在自己的窄路由空间有效，绝不能退化成 Renderer API 的通行证。 */
export function isConversationControlApiPath(requestPath: string): boolean {
  return requestPath === CONVERSATION_CONTROL_BRIDGE_PATH
    || requestPath.startsWith(`${CONVERSATION_CONTROL_BRIDGE_PATH}/`);
}
