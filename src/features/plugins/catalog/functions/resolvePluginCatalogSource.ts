import { createPublicKey } from 'node:crypto';

import type { PluginCatalogChannel } from '@app/schemas';

import type { DistributionIdentity } from '../../../../shared/distribution-identity';
import { isOfficialPluginRemoteServiceEnabled } from '../../install/functions/isOfficialPluginRemoteServiceEnabled';
import type { TrustedPluginCatalogKeys } from '../definitions/pluginCatalog';
import { trustedPluginCatalogKeys } from '../registry/trustedPluginCatalogKeys';
import { resolvePluginCatalogUrl } from './resolvePluginCatalogUrl';

/**
 * 开发用插件 catalog：只在源码运行（distribution kind = source）时生效，且只接受本机回环地址。
 * 用于端到端验证远程安装、运行时组件与启动准入；打包产物（社区或官方）一律忽略这些变量。
 */
export const DEVELOPMENT_PLUGIN_CATALOG_ENV = Object.freeze({
  url: 'LINNYA_DEV_PLUGIN_CATALOG_URL',
  keyId: 'LINNYA_DEV_PLUGIN_CATALOG_KEY_ID',
  /** Ed25519 公钥：SPKI PEM，或其 DER 的 base64。 */
  publicKey: 'LINNYA_DEV_PLUGIN_CATALOG_PUBLIC_KEY',
});

export interface PluginCatalogSource {
  readonly kind: 'official' | 'development';
  readonly catalogUrl: string;
  readonly channel: PluginCatalogChannel;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly allowLoopbackHttp: boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function readDevelopmentCatalog(
  identity: Pick<DistributionIdentity, 'kind'>,
  env: Environment,
): { readonly catalogUrl: string; readonly keyId: string; readonly publicKeyPem: string } | null {
  if (identity.kind !== 'source') return null;
  const rawUrl = env[DEVELOPMENT_PLUGIN_CATALOG_ENV.url]?.trim();
  const keyId = env[DEVELOPMENT_PLUGIN_CATALOG_ENV.keyId]?.trim();
  const rawKey = env[DEVELOPMENT_PLUGIN_CATALOG_ENV.publicKey]?.trim();
  if (!rawUrl || !keyId || !rawKey) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  let publicKeyPem: string;
  try {
    const key = rawKey.includes('BEGIN PUBLIC KEY')
      ? createPublicKey(rawKey)
      : createPublicKey({ key: Buffer.from(rawKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return null;
    publicKeyPem = key.export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    return null;
  }
  return { catalogUrl: url.toString(), keyId, publicKeyPem };
}

/**
 * 启动准入、运行时复核与安装共用的信任环：生产公钥，加上源码运行时显式配置的开发公钥。
 * 三处必须一致，否则开发安装的插件或运行时会在下次启动被拒绝。
 */
export function resolveTrustedPluginCatalogKeys(input: {
  readonly identity: Pick<DistributionIdentity, 'kind'>;
  readonly env: Environment;
}): TrustedPluginCatalogKeys {
  const development = readDevelopmentCatalog(input.identity, input.env);
  if (!development || Object.prototype.hasOwnProperty.call(trustedPluginCatalogKeys, development.keyId)) return trustedPluginCatalogKeys;
  return Object.freeze({ ...trustedPluginCatalogKeys, [development.keyId]: development.publicKeyPem });
}

/** 远程插件来源：官方服务开放时只给官方 Desktop；否则源码运行可用开发 catalog；都不满足返回 null（不发请求）。 */
export function resolvePluginCatalogSource(input: {
  readonly identity: DistributionIdentity;
  readonly env: Environment;
}): PluginCatalogSource | null {
  if (isOfficialPluginRemoteServiceEnabled(input.identity)) {
    return {
      kind: 'official',
      catalogUrl: resolvePluginCatalogUrl('stable'),
      channel: 'stable',
      trustedKeys: trustedPluginCatalogKeys,
      allowLoopbackHttp: false,
    };
  }
  const development = readDevelopmentCatalog(input.identity, input.env);
  if (!development) return null;
  return {
    kind: 'development',
    catalogUrl: development.catalogUrl,
    channel: 'stable',
    trustedKeys: resolveTrustedPluginCatalogKeys(input),
    allowLoopbackHttp: true,
  };
}
