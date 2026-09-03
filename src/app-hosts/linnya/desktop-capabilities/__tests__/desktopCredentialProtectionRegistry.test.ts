import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDesktopCredentialProtectionPortForTesting,
  getDesktopCredentialProtectionPort,
  installDesktopCredentialProtectionPort,
  type DesktopCredentialProtectionPort,
} from '..';

afterEach(clearDesktopCredentialProtectionPortForTesting);

describe('Desktop credential protection registry', () => {
  it('同一 App owner 只允许一个实现，重复安装同一实例保持幂等', () => {
    const first = createPort('first');
    installDesktopCredentialProtectionPort(first);
    installDesktopCredentialProtectionPort(first);
    expect(getDesktopCredentialProtectionPort()).toBe(first);

    expect(() => installDesktopCredentialProtectionPort(createPort('second')))
      .toThrow('已安装另一实现');
  });

  it('composition 未安装时 fail closed', () => {
    expect(() => getDesktopCredentialProtectionPort()).toThrow('尚未');
  });
});

function createPort(prefix: string): DesktopCredentialProtectionPort {
  return Object.freeze({
    encrypt: async (plaintext: string) => `${prefix}:${plaintext}`,
    decrypt: async (ciphertext: string) => ciphertext.slice(prefix.length + 1),
  });
}
