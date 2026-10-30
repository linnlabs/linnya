import type { TrustedDesktopDistributionKeys } from '../definitions/desktopDistributionManifest';

/**
 * 只保存可公开的公钥；私钥只位于受保护的发布环境。轮换时加入新 key，泄露时删除旧 key。
 */
export const trustedDesktopDistributionKeys: TrustedDesktopDistributionKeys = Object.freeze({
  'linnya-desktop-2026-d85adc': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhMCJ2Kp5fNwqPXZt9ZqiV1KVziIO27Cdz5IA0aaHNC4=
-----END PUBLIC KEY-----
`,
});
