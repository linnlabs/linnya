import type { TrustedPluginCatalogKeys } from '../definitions/pluginCatalog';

/**
 * 官方插件 catalog 公钥。与 Desktop 发行密钥分开，插件发布的轮换与吊销不牵连 Desktop 身份。
 * 只保存可公开的公钥；私钥与口令只在 linnya-release 的发布机（钥匙目录 + 登录钥匙串）。
 * 轮换时先新增 key、用新 key 发布，再在之后的版本移除旧 key；私钥泄露时立即移除对应 key。
 */
export const trustedPluginCatalogKeys: TrustedPluginCatalogKeys = Object.freeze({
  'linnya-plugins-2026-2607f6': [
    '-----BEGIN PUBLIC KEY-----',
    'MCowBQYDK2VwAyEAuznFJctp8Ma3ahqInOC8Zh6ll6apExxwR7Oyxj1Y91E=',
    '-----END PUBLIC KEY-----',
    '',
  ].join('\n'),
});
