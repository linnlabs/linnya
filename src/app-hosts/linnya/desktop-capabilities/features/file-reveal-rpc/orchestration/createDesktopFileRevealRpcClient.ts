import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopFileRevealPort } from '../../../definitions/desktopFileRevealPort';
import { DESKTOP_FILE_REVEAL_RPC_METHOD } from '../definitions/fileRevealRpc';
import { parseDesktopFileRevealRpcResponse } from '../functions/fileRevealRpcCodec';

export function createDesktopFileRevealRpcClient(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): DesktopFileRevealPort {
  return Object.freeze({
    async revealInFileManager(absolutePath: string): Promise<void> {
      const response = await rpc.request(DESKTOP_FILE_REVEAL_RPC_METHOD, { absolutePath });
      parseDesktopFileRevealRpcResponse(response);
    },
  });
}
