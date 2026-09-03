import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { DesktopCredentialProtectionPort } from '../../../definitions/desktopCredentialProtectionPort';
import {
  DESKTOP_CREDENTIAL_DECRYPT_RPC_METHOD,
  DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD,
} from '../definitions/credentialProtectionRpc';
import {
  parseDesktopCredentialDecryptRpcRequest,
  parseDesktopCredentialEncryptRpcRequest,
} from '../functions/credentialProtectionRpcCodec';

/** Desktop composition 显式注册两种 safeStorage 操作，不开放任意 Electron 方法调用。 */
export function createDesktopCredentialProtectionRpcHandlers(
  port: DesktopCredentialProtectionPort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD, async payload => {
      const request = parseDesktopCredentialEncryptRpcRequest(payload);
      return { ciphertext: await port.encrypt(request.plaintext) };
    }],
    [DESKTOP_CREDENTIAL_DECRYPT_RPC_METHOD, async payload => {
      const request = parseDesktopCredentialDecryptRpcRequest(payload);
      return { plaintext: await port.decrypt(request.ciphertext) };
    }],
  ]);
}
