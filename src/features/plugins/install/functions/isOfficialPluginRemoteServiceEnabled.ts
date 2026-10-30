import type { DistributionIdentity } from '../../../../shared/distribution-identity';

/** 发布者签名 catalog 完成前只提供随包插件；Desktop 身份不能代替插件来源证明。 */
const OFFICIAL_PLUGIN_REMOTE_SERVICE_OPEN: boolean = false;

/** 服务开放后仍仅允许通过发行验签的 Desktop 连接官方插件源。 */
export function isOfficialPluginRemoteServiceEnabled(
  distributionIdentity: DistributionIdentity,
): boolean {
  return OFFICIAL_PLUGIN_REMOTE_SERVICE_OPEN && distributionIdentity.kind === 'official';
}
