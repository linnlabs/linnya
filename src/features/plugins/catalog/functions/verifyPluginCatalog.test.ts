import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PluginCatalogRejectedError } from '../definitions/pluginCatalog';
import { trustedPluginCatalogKeys } from '../registry/trustedPluginCatalogKeys';
import { verifyPluginCatalog } from './verifyPluginCatalog';

const NOW = new Date('2026-11-22T00:00:00.000Z');

function keyPair(): { privateKey: KeyObject; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

const publisher = keyPair();
const trustedKeys = { 'linnya-plugins-test': publisher.publicPem };

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'stable',
    sequence: 7,
    issuedAt: '2026-11-21T00:00:00.000Z',
    expiresAt: '2026-12-21T00:00:00.000Z',
    plugins: [{
      id: 'knowledge',
      name: '知识库',
      version: '0.2.0',
      developer: 'Linnya',
      description: '管理资料、检索知识并在项目中关联使用。',
      minApp: '0.2.1',
      rendererUi: '^3.5.0',
      artifactUrl: 'https://download.linnya.com/plugins/artifacts/knowledge/0.2.0/knowledge-0.2.0.zip',
      sha512: 'a'.repeat(128),
      size: 12_000_000,
      unpackedSize: 40_000_000,
      requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }],
    }],
    runtimes: [{
      id: 'qdrant',
      version: '1.14.1',
      targets: [{
        platform: 'darwin',
        architecture: 'arm64',
        artifactUrl: 'https://download.linnya.com/plugins/runtimes/qdrant/1.14.1/darwin-arm64/qdrant-1.14.1-darwin-arm64.zip',
        sha512: 'b'.repeat(128),
        size: 25_000_000,
        unpackedSize: 64_000_000,
        executable: 'qdrant',
        executableSha256: 'c'.repeat(64),
      }],
    }],
    revoked: [],
    ...overrides,
  };
}

function envelope(body: unknown, options: { keyId?: string; privateKey?: KeyObject; tamper?: (bytes: Buffer) => Buffer } = {}): string {
  const payloadBytes = Buffer.from(JSON.stringify(body), 'utf8');
  const signature = sign(null, payloadBytes, options.privateKey ?? publisher.privateKey);
  const shipped = options.tamper ? options.tamper(payloadBytes) : payloadBytes;
  return JSON.stringify({
    schemaVersion: 1,
    keyId: options.keyId ?? 'linnya-plugins-test',
    payload: shipped.toString('base64'),
    signature: signature.toString('base64'),
  });
}

function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof PluginCatalogRejectedError) return error.code;
    throw error;
  }
  throw new Error('catalog was accepted');
}

const verifyText = (catalogText: string, extra: Partial<Parameters<typeof verifyPluginCatalog>[0]> = {}) =>
  verifyPluginCatalog({ catalogText, trustedKeys, expectedChannel: 'stable', now: NOW, ...extra });

describe('官方插件 catalog 验签', () => {
  it('接受发布方签名的 catalog，返回 key id、payload 摘要、展示字段与运行时依赖', () => {
    const verified = verifyText(envelope(payload()));
    expect(verified.keyId).toBe('linnya-plugins-test');
    expect(verified.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(verified.sequence).toBe(7);
    expect(verified.plugins).toEqual([expect.objectContaining({
      id: 'knowledge', name: '知识库', version: '0.2.0', size: 12_000_000, unpackedSize: 40_000_000,
      requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }],
    })]);
    expect(verified.runtimes[0]?.targets[0]).toMatchObject({ platform: 'darwin', executable: 'qdrant' });
    expect(Object.isFrozen(verified.plugins[0])).toBe(true);
  });

  it('生产公钥尚未加入前，任何 catalog 都不能通过验签', () => {
    expect(Object.keys(trustedPluginCatalogKeys)).toEqual([]);
    expect(rejection(() => verifyPluginCatalog({
      catalogText: envelope(payload()), trustedKeys: trustedPluginCatalogKeys, expectedChannel: 'stable', now: NOW,
    }))).toBe('untrusted-key');
  });

  it('签名后改动任何 payload 字节都被拒绝', () => {
    const tampered = envelope(payload(), {
      tamper: bytes => Buffer.from(bytes.toString('utf8').replace('"sequence":7', '"sequence":8'), 'utf8'),
    });
    expect(rejection(() => verifyText(tampered))).toBe('bad-signature');
  });

  it('未登记 key id、或用其他私钥冒签已登记 key id，均被拒绝', () => {
    expect(rejection(() => verifyText(envelope(payload(), { keyId: 'unknown' })))).toBe('untrusted-key');
    expect(rejection(() => verifyText(envelope(payload(), { privateKey: keyPair().privateKey })))).toBe('bad-signature');
  });

  it('信封或 payload 格式不对时失败关闭', () => {
    expect(rejection(() => verifyText('not json'))).toBe('malformed');
    expect(rejection(() => verifyText(JSON.stringify({ schemaVersion: 1, keyId: 'linnya-plugins-test', payload: 'a b', signature: 'x' })))).toBe('malformed');
    expect(rejection(() => verifyText(envelope({ ...payload(), unexpected: true })))).toBe('malformed');
    expect(rejection(() => verifyText(envelope(payload({ plugins: [{ ...(payload().plugins as object[])[0], sha512: 'short' }] }))))).toBe('malformed');
    expect(rejection(() => verifyText(envelope(payload({
      runtimes: [{ id: 'qdrant', version: '1.14.1', targets: [{ ...((payload().runtimes as { targets: object[] }[])[0]!.targets[0]), executable: '../qdrant' }] }],
    }))))).toBe('malformed');
  });

  it('下载地址必须是 https；只有显式开启时才接受本机 http', () => {
    const local = payload({ plugins: [{ ...(payload().plugins as object[])[0], artifactUrl: 'http://127.0.0.1:8123/knowledge.zip' }] });
    expect(rejection(() => verifyText(envelope(local)))).toBe('insecure-url');
    expect(verifyText(envelope(local), { allowLoopbackHttp: true }).plugins).toHaveLength(1);
    const remote = payload({ plugins: [{ ...(payload().plugins as object[])[0], artifactUrl: 'http://download.linnya.com/knowledge.zip' }] });
    expect(rejection(() => verifyText(envelope(remote), { allowLoopbackHttp: true }))).toBe('insecure-url');
  });

  it('通道、有效期与时钟偏差边界', () => {
    expect(rejection(() => verifyText(envelope(payload({ channel: 'beta' }))))).toBe('wrong-channel');
    expect(rejection(() => verifyText(envelope(payload()), { now: new Date('2026-12-21T00:00:00.000Z') }))).toBe('expired');
    expect(verifyText(envelope(payload()), { now: new Date('2026-12-20T23:59:59.999Z') }).sequence).toBe(7);
    expect(verifyText(envelope(payload()), { now: new Date('2026-11-20T23:55:00.000Z') }).sequence).toBe(7);
    expect(rejection(() => verifyText(envelope(payload()), { now: new Date('2026-11-20T23:54:59.999Z') }))).toBe('not-yet-valid');
    expect(rejection(() => verifyText(envelope(payload({ expiresAt: '2026-11-21T00:00:00.000Z' }))))).toBe('malformed');
    expect(rejection(() => verifyText(envelope(payload({ expiresAt: '2027-03-01T00:00:00.000Z' }))))).toBe('malformed');
  });

  it('拒绝回退到更小序号，以及同序号但内容不同的 catalog；同一份可重复接受', () => {
    const accepted = verifyText(envelope(payload()));
    const mark = { sequence: accepted.sequence, digest: accepted.digest };
    expect(verifyText(envelope(payload()), { highWaterMark: mark }).digest).toBe(accepted.digest);
    expect(verifyText(envelope(payload({ sequence: 8 })), { highWaterMark: mark }).sequence).toBe(8);
    expect(rejection(() => verifyText(envelope(payload({ sequence: 6 })), { highWaterMark: mark }))).toBe('rollback');
    expect(rejection(() => verifyText(envelope(payload({ issuedAt: '2026-11-21T00:00:01.000Z' })), { highWaterMark: mark }))).toBe('rollback');
  });

  it('撤回的插件与运行时版本不出现在结果中；重复版本或重复平台视为格式错误', () => {
    const revoked = verifyText(envelope(payload({
      revoked: [{ kind: 'plugin', id: 'knowledge', version: '0.2.0' }, { kind: 'runtime', id: 'qdrant', version: '1.14.1' }],
    })));
    expect(revoked.plugins).toEqual([]);
    expect(revoked.runtimes).toEqual([]);
    expect(revoked.revoked).toHaveLength(2);
    const base = payload();
    expect(rejection(() => verifyText(envelope({ ...base, plugins: [...(base.plugins as object[]), ...(base.plugins as object[])] })))).toBe('malformed');
    const runtime = (base.runtimes as { targets: object[] }[])[0]!;
    expect(rejection(() => verifyText(envelope({ ...base, runtimes: [{ ...runtime, targets: [...runtime.targets, ...runtime.targets] }] })))).toBe('malformed');
  });
});
