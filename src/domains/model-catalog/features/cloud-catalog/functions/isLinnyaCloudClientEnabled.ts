import type { DistributionIdentity } from '../../../../../shared/distribution-identity';

/**
 * 源码和社区构建不连接 Linnya Cloud；只有验签通过的官方发行可以进入客户端接入边界。
 * 这不是服务端授权。账号 token、entitlement 与计量完成前 Cloud 数据面仍须保持关闭。
 */
export function isLinnyaCloudClientEnabled(identity: DistributionIdentity): boolean {
  return identity.kind === 'official';
}
