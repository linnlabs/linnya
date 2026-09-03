import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { DesktopFileRevealPort } from '../../../definitions/desktopFileRevealPort';
import { DESKTOP_FILE_REVEAL_RPC_METHOD } from '../definitions/fileRevealRpc';
import { parseDesktopFileRevealRpcRequest } from '../functions/fileRevealRpcCodec';

export function createDesktopFileRevealRpcHandlers(
  port: DesktopFileRevealPort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_FILE_REVEAL_RPC_METHOD, async payload => {
      const request = parseDesktopFileRevealRpcRequest(payload);
      await port.revealInFileManager(request.absolutePath);
      return null;
    }],
  ]);
}
