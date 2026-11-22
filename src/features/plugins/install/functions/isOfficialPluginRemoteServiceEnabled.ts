import type { DistributionIdentity } from '../../../../shared/distribution-identity';

/**
 * 官方插件远程服务已开放：catalog 由独立插件密钥签名（trustedPluginCatalogKeys）。
 * Desktop 身份不能代替插件来源证明；开放后每份 catalog 与每次安装仍按签名、序号与撤回规则失败关闭。
 */
const OFFICIAL_PLUGIN_REMOTE_SERVICE_OPEN: boolean = true;

/** 服务开放后仍仅允许通过发行验签的 Desktop 连接官方插件源。 */
export function isOfficialPluginRemoteServiceEnabled(
  distributionIdentity: DistributionIdentity,
): boolean {
  return OFFICIAL_PLUGIN_REMOTE_SERVICE_OPEN && distributionIdentity.kind === 'official';
}
