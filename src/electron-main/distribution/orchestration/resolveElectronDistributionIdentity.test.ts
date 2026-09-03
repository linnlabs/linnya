import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { resolveElectronDistributionIdentity } from './resolveElectronDistributionIdentity';

describe('resolveElectronDistributionIdentity', () => {
  it('源码运行固定为 source，且不读取发行清单', () => {
    let readCount = 0;
    const result = resolveElectronDistributionIdentity({
      packaged: false,
      resourcesPath: '/resources',
      applicationVersion: '0.0.38',
      readManifest: () => {
        readCount += 1;
        return '{}';
      },
    });

    expect(result).toEqual({
      identity: { kind: 'source', packaged: false },
      evidence: 'source-runtime',
    });
    expect(readCount).toBe(0);
  });

  it('打包态缺少或无法验证发行清单时安全降为 community', () => {
    const absent = resolveElectronDistributionIdentity({
      packaged: true,
      resourcesPath: '/resources',
      applicationVersion: '0.0.38',
      readManifest: () => {
        const error = new Error('missing');
        Object.defineProperty(error, 'code', { value: 'ENOENT' });
        throw error;
      },
    });
    const invalid = resolveElectronDistributionIdentity({
      packaged: true,
      resourcesPath: '/resources',
      applicationVersion: '0.0.38',
      readManifest: () => '{}',
    });

    expect(absent).toEqual({
      identity: { kind: 'community', packaged: true },
      evidence: 'manifest-absent',
    });
    expect(invalid.identity).toEqual({ kind: 'community', packaged: true });
    expect(invalid.evidence).toBe('invalid-manifest');
  });

  it('打包态只有受信签名和应用版本同时匹配才成为 official', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from(JSON.stringify({
      schema_version: 1,
      application_id: 'com.skysiix.Linnya',
      application_version: '0.0.38',
      distribution: 'official',
      release_channel: 'beta',
    }), 'utf8');
    const manifest = JSON.stringify({
      schema_version: 1,
      key_id: 'fixture-key',
      payload: payload.toString('base64'),
      signature: sign(null, payload, privateKey).toString('base64'),
    });

    const result = resolveElectronDistributionIdentity({
      packaged: true,
      resourcesPath: '/resources',
      applicationVersion: '0.0.38',
      readManifest: () => manifest,
      trustedKeys: {
        'fixture-key': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    });

    expect(result).toEqual({
      identity: {
        kind: 'official',
        packaged: true,
        releaseChannel: 'beta',
        releaseKeyId: 'fixture-key',
      },
      evidence: 'verified-manifest',
    });
  });
});
