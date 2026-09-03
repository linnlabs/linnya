import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../../app-server-rpc';
import type { ExternalAuthorizationBrowserPort } from '../../../definitions/providerAccountAuthorization';
import {
  DESKTOP_EXTERNAL_AUTHORIZATION_BROWSER_OPEN_RPC_METHOD,
} from '../definitions/externalAuthorizationBrowserRpc';
import {
  parseExternalAuthorizationBrowserOpenRpcRequest,
} from '../functions/externalAuthorizationBrowserRpcCodec';

/** Desktop 端只注册 OAuth 外部浏览器能力，不把 Electron shell 暴露给 Backend。 */
export function createExternalAuthorizationBrowserRpcHandlers(
  browser: ExternalAuthorizationBrowserPort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_EXTERNAL_AUTHORIZATION_BROWSER_OPEN_RPC_METHOD, async payload => {
      const request = parseExternalAuthorizationBrowserOpenRpcRequest(payload);
      await browser.open(request.url);
      return null;
    }],
  ]);
}
