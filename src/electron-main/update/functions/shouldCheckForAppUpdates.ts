import type { DistributionIdentity } from '../../../shared/distribution-identity';

export interface AppUpdateCheckEnvironment {
  readonly LINNYA_DISABLE_UPDATE_CHECKS?: string;
}

/** 只有验签通过的官方发行版才允许连接正式更新服务。 */
export function shouldCheckForAppUpdates(
  distributionIdentity: DistributionIdentity,
  environment: AppUpdateCheckEnvironment,
): boolean {
  if (distributionIdentity.kind !== 'official') return false;
  return environment.LINNYA_DISABLE_UPDATE_CHECKS !== '1';
}
