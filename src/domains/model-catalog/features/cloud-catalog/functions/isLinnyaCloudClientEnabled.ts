import type { DistributionIdentity } from '../../../../../shared/distribution-identity';

/** 账号 token、entitlement 与计量完成前 Cloud 模型服务不开放，官方发行也不连接。 */
const LINNYA_CLOUD_MODEL_SERVICE_OPEN: boolean = false;

/**
 * 源码和社区构建不连接 Linnya Cloud；服务开放后只有验签通过的官方发行可以进入客户端接入边界。
 * 这不是服务端授权。
 */
export function isLinnyaCloudClientEnabled(identity: DistributionIdentity): boolean {
  return LINNYA_CLOUD_MODEL_SERVICE_OPEN && identity.kind === 'official';
}
