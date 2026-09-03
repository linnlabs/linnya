import type { AppServerRpcPeer } from '../../../../../app-server-rpc';
import type { ExternalAuthorizationBrowserPort } from '../../../definitions/providerAccountAuthorization';
import {
  DESKTOP_EXTERNAL_AUTHORIZATION_BROWSER_OPEN_RPC_METHOD,
} from '../definitions/externalAuthorizationBrowserRpc';
import {
  parseExternalAuthorizationBrowserOpenRpcRequest,
  parseExternalAuthorizationBrowserOpenRpcResponse,
} from '../functions/externalAuthorizationBrowserRpcCodec';

/** Provider authorization 用例仍只看到 browser port；raw reverse RPC 不进入业务编排。 */
export function createExternalAuthorizationBrowserRpcClient(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): ExternalAuthorizationBrowserPort {
  return Object.freeze({
    async open(url: string): Promise<void> {
      const request = parseExternalAuthorizationBrowserOpenRpcRequest({ url });
      const response = await rpc.request(
        DESKTOP_EXTERNAL_AUTHORIZATION_BROWSER_OPEN_RPC_METHOD,
        { url: request.url },
      );
      parseExternalAuthorizationBrowserOpenRpcResponse(response);
    },
  });
}
