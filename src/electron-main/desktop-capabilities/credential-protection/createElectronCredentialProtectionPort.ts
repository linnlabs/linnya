import { safeStorage } from 'electron';

import type {
  DesktopCredentialProtectionPort,
} from '../../../app-hosts/linnya/desktop-capabilities';

/** Electron adapter 只拥有系统加解密，不读取或持久化业务 credential。 */
export function createElectronCredentialProtectionPort(): DesktopCredentialProtectionPort {
  return Object.freeze({
    async encrypt(plaintext: string) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('系统安全存储当前不可用，无法保存模型供应商凭据。');
      }
      return safeStorage.encryptString(plaintext).toString('base64');
    },
    async decrypt(ciphertext: string) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('系统安全存储当前不可用，无法读取模型供应商凭据。');
      }
      return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
    },
  });
}
