import type { TrustedPluginCatalogKeys } from '../definitions/pluginCatalog';

/**
 * 官方插件 catalog 公钥。与 Desktop 发行密钥分开，插件发布的轮换与吊销不牵连 Desktop 身份。
 * 只保存可公开的公钥；私钥只在 linnya-release 的受保护发布环境。生产公钥在正式发布获批后加入，
 * 在此之前没有任何 catalog 能通过验签，远程安装保持失败关闭。
 */
export const trustedPluginCatalogKeys: TrustedPluginCatalogKeys = Object.freeze({});
