import { safeStorage } from 'electron';

import type {
  DesktopCredentialProtectionPort,
} from '../../../app-hosts/linnya/desktop-capabilities';
import { CredentialProtectionError } from '../../../shared/credential-protection';

/** Electron adapter 只拥有系统加解密，不读取或持久化业务 credential。 */
export function createElectronCredentialProtectionPort(): DesktopCredentialProtectionPort {
  return Object.freeze({
    async encrypt(plaintext: string) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
      try {
        return (await safeStorage.encryptStringAsync(plaintext)).toString('base64');
      } catch {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
    },
    async decrypt(ciphertext: string) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
      if (!ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(ciphertext)) {
        throw new CredentialProtectionError('malformed_ciphertext');
      }
      try {
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
        return decrypted.result;
      } catch {
        throw new CredentialProtectionError('invalidated');
      }
    },
  });
}
