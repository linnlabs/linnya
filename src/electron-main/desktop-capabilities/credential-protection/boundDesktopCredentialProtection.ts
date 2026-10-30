import type { DesktopCredentialProtectionPort } from '../../../app-hosts/linnya/desktop-capabilities';
import {
  CredentialProtectionError,
  readCredentialProtectionErrorCode,
} from '../../../shared/credential-protection';

const DEFAULT_KEYRING_WAIT_MS = 3_000;

/**
 * 系统钥匙串可能在等待用户响应授权弹窗。启动和读取凭据不能被它卡住：超时后按暂时不可用
 * 继续，原请求保持未决，用户授权后下一次读取直接成功。读取被拒绝后不再自动询问，避免反复
 * 弹窗；用户主动保存凭据（encrypt）才会重新询问。超时和拒绝都不会创建新的 master key。
 */
export function boundDesktopCredentialProtection(
  protection: DesktopCredentialProtectionPort,
  options: { readonly waitMs?: number } = {},
): DesktopCredentialProtectionPort {
  const waitMs = options.waitMs ?? DEFAULT_KEYRING_WAIT_MS;
  let refused = false;
  let waitingForUser = false;

  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    // 已有请求在等用户时不再累积等待，否则多条凭据会逐条超时，拖慢启动。
    if (refused || waitingForUser) throw new CredentialProtectionError('temporarily_unavailable');
    let settled = false;
    const running = operation()
      .catch((error: unknown) => {
        if (readCredentialProtectionErrorCode(error) === 'temporarily_unavailable') refused = true;
        throw error;
      })
      .finally(() => {
        settled = true;
        waitingForUser = false;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!settled) waitingForUser = true;
        reject(new CredentialProtectionError('temporarily_unavailable'));
      }, waitMs);
    });
    try {
      return await Promise.race([running, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({
    async encrypt(plaintext: string) {
      const ciphertext = await protection.encrypt(plaintext);
      refused = false;
      return ciphertext;
    },
    decrypt: (ciphertext: string) => bounded(() => protection.decrypt(ciphertext)),
    rewrap: (ciphertext: string) => bounded(() => protection.rewrap(ciphertext)),
  });
}
