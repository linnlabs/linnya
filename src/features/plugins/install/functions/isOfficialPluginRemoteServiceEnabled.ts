import type { DistributionIdentity } from '../../../../shared/distribution-identity';

/** 未经 Desktop 发行验签的构建不能连接 Linnya 官方插件下载与更新服务。 */
export function isOfficialPluginRemoteServiceEnabled(
  distributionIdentity: DistributionIdentity,
): boolean {
  return distributionIdentity.kind === 'official';
}
