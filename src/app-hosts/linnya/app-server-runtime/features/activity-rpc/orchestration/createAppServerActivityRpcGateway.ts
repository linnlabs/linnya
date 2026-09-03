import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { AppServerActivityGatewayPort } from '../definitions/appServerActivityRpc';
import { BACKEND_APP_ACTIVITY_READ_RPC_METHOD } from '../definitions/appServerActivityRpc';
import { parseAppServerActivitySnapshot } from '../functions/appServerActivityRpcCodec';

export function createAppServerActivityRpcGateway(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): AppServerActivityGatewayPort {
  return Object.freeze({
    async read() {
      return parseAppServerActivitySnapshot(
        await rpc.request(BACKEND_APP_ACTIVITY_READ_RPC_METHOD, null),
      );
    },
  });
}
