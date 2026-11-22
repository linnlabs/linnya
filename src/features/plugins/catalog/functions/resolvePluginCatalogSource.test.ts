import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { trustedPluginCatalogKeys } from '../registry/trustedPluginCatalogKeys';
import {
  DEVELOPMENT_PLUGIN_CATALOG_ENV,
  resolvePluginCatalogSource,
  resolveTrustedPluginCatalogKeys,
} from './resolvePluginCatalogSource';

const ed25519 = generateKeyPairSync('ed25519').publicKey;
const pem = ed25519.export({ type: 'spki', format: 'pem' }).toString();
const derBase64 = ed25519.export({ type: 'spki', format: 'der' }).toString('base64');

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'http://127.0.0.1:47123/catalog/stable.json',
    [DEVELOPMENT_PLUGIN_CATALOG_ENV.keyId]: 'linnya-plugins-dev',
    [DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]: pem,
    ...overrides,
  };
}

const source = { kind: 'source', packaged: false } as const;
const community = { kind: 'community', packaged: true } as const;
const official = { kind: 'official', packaged: true, releaseChannel: 'stable', releaseKeyId: 'linnya-desktop-1' } as const;

describe('插件 catalog 来源与信任环', () => {
  it('源码运行且配置齐全：使用本机开发 catalog，信任环加入开发公钥，允许回环 http', () => {
    const resolved = resolvePluginCatalogSource({ identity: source, env: env() });
    expect(resolved).toMatchObject({
      kind: 'development', catalogUrl: 'http://127.0.0.1:47123/catalog/stable.json', channel: 'stable', allowLoopbackHttp: true,
    });
    expect(Object.keys(resolved!.trustedKeys)).toContain('linnya-plugins-dev');
    expect(resolveTrustedPluginCatalogKeys({ identity: source, env: env() })).toEqual(resolved!.trustedKeys);
  });

  it('公钥接受 SPKI PEM 与 DER base64；localhost 与 [::1] 视为回环', () => {
    for (const overrides of [
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]: derBase64 },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'http://localhost:8080/c.json' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'https://[::1]:8443/c.json' },
    ]) {
      expect(resolvePluginCatalogSource({ identity: source, env: env(overrides) })?.kind).toBe('development');
    }
  });

  it('打包产物（社区、官方）忽略开发变量：不发请求，信任环保持生产公钥', () => {
    for (const identity of [community, official]) {
      // 官方远程服务尚未开放，官方 Desktop 此时同样没有来源。
      expect(resolvePluginCatalogSource({ identity, env: env() })).toBeNull();
      expect(resolveTrustedPluginCatalogKeys({ identity, env: env() })).toBe(trustedPluginCatalogKeys);
    }
  });

  it('非回环地址、非 http(s)、缺项、无效或非 Ed25519 公钥：开发 catalog 不生效', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    for (const overrides of [
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'http://192.168.1.10/catalog.json' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'https://download.linnya.com/plugins/catalog/stable.json' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'file:///tmp/catalog.json' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.url]: 'not a url' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.keyId]: '' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]: undefined },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]: 'not-a-key' },
      { [DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]: rsa },
    ]) {
      expect(resolvePluginCatalogSource({ identity: source, env: env(overrides) })).toBeNull();
      expect(resolveTrustedPluginCatalogKeys({ identity: source, env: env(overrides) })).toBe(trustedPluginCatalogKeys);
    }
  });
});
