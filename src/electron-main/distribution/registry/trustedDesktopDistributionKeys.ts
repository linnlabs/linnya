import type { TrustedDesktopDistributionKeys } from '../definitions/desktopDistributionManifest';

/**
 * 正式 Desktop 发行 key 建立前保持为空。公开 key 可以进入源码；私钥只能位于受保护
 * 发布环境。空 key ring 会让所有 packaged 构建安全地落到 community。
 */
export const trustedDesktopDistributionKeys: TrustedDesktopDistributionKeys = Object.freeze({});
