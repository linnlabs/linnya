import { safeStorage } from 'electron';

import type {
  DesktopCredentialProtectionPort,
} from '../../../app-hosts/linnya/desktop-capabilities';
import {
  createSystemCredentialProtectionPort,
  isSystemCredentialCiphertext,
} from '../../../infra/adapters/credential-protection/system-keyring';
import { CredentialProtectionError } from '../../../shared/credential-protection';

/** Desktop 首次建立共用系统密钥，并把旧 safeStorage 密文逐项重包为 CLI 可读格式。 */
export function createElectronCredentialProtectionPort(input: {
  readonly appDataRoot: string;
}): DesktopCredentialProtectionPort {
  const systemProtection = createSystemCredentialProtectionPort({
    vaultId: input.appDataRoot,
    allowMasterKeyCreation: true,
  });

  const decryptLegacy = async (ciphertext: string): Promise<string> => {
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
  };

  return Object.freeze({
    encrypt: (plaintext: string) => systemProtection.encrypt(plaintext),
    async decrypt(ciphertext: string) {
      return isSystemCredentialCiphertext(ciphertext)
        ? systemProtection.decrypt(ciphertext)
        : decryptLegacy(ciphertext);
    },
    async rewrap(ciphertext: string) {
      if (isSystemCredentialCiphertext(ciphertext)) return undefined;
      return systemProtection.encrypt(await decryptLegacy(ciphertext));
    },
  });
}
