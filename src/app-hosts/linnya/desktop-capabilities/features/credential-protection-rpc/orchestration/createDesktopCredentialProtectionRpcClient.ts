import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopCredentialProtectionPort } from '../../../definitions/desktopCredentialProtectionPort';
import { decodeCredentialProtectionError } from '../../../../../../shared/credential-protection';
import {
  DESKTOP_CREDENTIAL_DECRYPT_RPC_METHOD,
  DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD,
} from '../definitions/credentialProtectionRpc';
import {
  parseDesktopCredentialDecryptRpcResponse,
  parseDesktopCredentialEncryptRpcResponse,
} from '../functions/credentialProtectionRpcCodec';

/** App Server 侧只取得 credential port，不取得 raw RPC 或 Electron safeStorage。 */
export function createDesktopCredentialProtectionRpcClient(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): DesktopCredentialProtectionPort {
  return Object.freeze({
    async encrypt(plaintext: string): Promise<string> {
      try {
        const response = await rpc.request(DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD, { plaintext });
        return parseDesktopCredentialEncryptRpcResponse(response).ciphertext;
      } catch (error: unknown) {
        throw decodeCredentialProtectionError(error) ?? error;
      }
    },
    async decrypt(ciphertext: string): Promise<string> {
      try {
        const response = await rpc.request(DESKTOP_CREDENTIAL_DECRYPT_RPC_METHOD, { ciphertext });
        return parseDesktopCredentialDecryptRpcResponse(response).plaintext;
      } catch (error: unknown) {
        throw decodeCredentialProtectionError(error) ?? error;
      }
    },
  });
}
