import { describe, expect, it, vi } from 'vitest';
import { CredentialProtectionError } from '../../../shared/credential-protection';
import { boundDesktopCredentialProtection } from './boundDesktopCredentialProtection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createPort(decrypt: (ciphertext: string) => Promise<string>) {
  return {
    encrypt: vi.fn(async (plaintext: string) => `sealed:${plaintext}`),
    decrypt: vi.fn(decrypt),
    rewrap: vi.fn(async () => undefined),
  };
}

describe('boundDesktopCredentialProtection', () => {
  it('钥匙串等待用户时按暂时不可用返回，授权后下一次读取成功', async () => {
    const keychain = deferred<string>();
    const port = createPort(() => keychain.promise);
    const bounded = boundDesktopCredentialProtection(port, { waitMs: 5 });

    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'temporarily_unavailable' });

    // 仍在等用户：其它凭据立即返回，不再逐条超时。
    await expect(bounded.decrypt('b')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(port.decrypt).toHaveBeenCalledTimes(1);

    keychain.resolve('secret');
    await keychain.promise;
    await new Promise(resolve => setImmediate(resolve));
    await expect(bounded.decrypt('a')).resolves.toBe('secret');
  });

  it('用户拒绝后不再自动询问，主动保存才重新询问', async () => {
    const port = createPort(async () => {
      throw new CredentialProtectionError('temporarily_unavailable');
    });
    const bounded = boundDesktopCredentialProtection(port, { waitMs: 50 });

    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(port.decrypt).toHaveBeenCalledTimes(1);

    await bounded.encrypt('new');
    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(port.decrypt).toHaveBeenCalledTimes(2);
  });

  it('其它错误原样返回且不影响后续读取', async () => {
    const port = createPort(async () => {
      throw new CredentialProtectionError('malformed_ciphertext');
    });
    const bounded = boundDesktopCredentialProtection(port, { waitMs: 50 });

    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'malformed_ciphertext' });
    await expect(bounded.decrypt('a')).rejects.toMatchObject({ code: 'malformed_ciphertext' });
    expect(port.decrypt).toHaveBeenCalledTimes(2);
  });
});
