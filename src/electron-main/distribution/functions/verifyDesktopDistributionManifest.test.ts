import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyDesktopDistributionManifest } from './verifyDesktopDistributionManifest';

function createSignedManifest(input?: { readonly applicationVersion?: string }) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payloadBytes = Buffer.from(JSON.stringify({
    schema_version: 1,
    application_id: 'com.skysiix.Linnya',
    application_version: input?.applicationVersion ?? '0.0.38',
    distribution: 'official',
    release_channel: 'stable',
  }), 'utf8');
  const manifestText = JSON.stringify({
    schema_version: 1,
    key_id: 'fixture-key',
    payload: payloadBytes.toString('base64'),
    signature: sign(null, payloadBytes, privateKey).toString('base64'),
  });
  return {
    manifestText,
    trustedKeys: {
      'fixture-key': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  };
}

describe('verifyDesktopDistributionManifest', () => {
  it('只把受信 key 对匹配版本 payload 的签名解析为 official', () => {
    const fixture = createSignedManifest();
    expect(verifyDesktopDistributionManifest({
      ...fixture,
      applicationVersion: '0.0.38',
    })).toEqual({
      kind: 'official',
      packaged: true,
      releaseChannel: 'stable',
      releaseKeyId: 'fixture-key',
    });
  });

  it('拒绝篡改、未知 key 和版本漂移', () => {
    const fixture = createSignedManifest();
    const parsed = JSON.parse(fixture.manifestText);
    const tamperedPayload = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(parsed.payload, 'base64').toString('utf8')),
      release_channel: 'beta',
    })).toString('base64');

    expect(() => verifyDesktopDistributionManifest({
      manifestText: JSON.stringify({ ...parsed, payload: tamperedPayload }),
      applicationVersion: '0.0.38',
      trustedKeys: fixture.trustedKeys,
    })).toThrow('签名无效');
    expect(() => verifyDesktopDistributionManifest({
      manifestText: fixture.manifestText,
      applicationVersion: '0.0.38',
      trustedKeys: {},
    })).toThrow('不受信任');
    expect(() => verifyDesktopDistributionManifest({
      ...fixture,
      applicationVersion: '0.0.39',
    })).toThrow('版本不匹配');
  });
});
