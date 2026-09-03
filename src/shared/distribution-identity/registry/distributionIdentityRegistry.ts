import type { DistributionIdentity } from '../definitions/distributionIdentity';
import { createDistributionIdentity } from '../functions/createDistributionIdentity';

const DISTRIBUTION_IDENTITY_KEY = '__LINNYA_DISTRIBUTION_IDENTITY__';

type DistributionIdentityStore = typeof globalThis & {
  [DISTRIBUTION_IDENTITY_KEY]?: DistributionIdentity;
};

/** 每个 Main/App Server 运行域只能安装一份由 Desktop Host 冻结的发行身份。 */
export function installDistributionIdentity(input: DistributionIdentity): DistributionIdentity {
  const store = globalThis as DistributionIdentityStore;
  const identity = createDistributionIdentity(input);
  const installed = store[DISTRIBUTION_IDENTITY_KEY];
  if (installed) {
    if (JSON.stringify(installed) !== JSON.stringify(identity)) {
      throw new Error('当前运行域已经绑定另一份 Desktop distribution identity');
    }
    return installed;
  }
  store[DISTRIBUTION_IDENTITY_KEY] = identity;
  return identity;
}

export function readInstalledDistributionIdentity(): DistributionIdentity | undefined {
  return (globalThis as DistributionIdentityStore)[DISTRIBUTION_IDENTITY_KEY];
}

export function requireInstalledDistributionIdentity(): DistributionIdentity {
  const identity = readInstalledDistributionIdentity();
  if (!identity) throw new Error('当前运行域尚未安装 Desktop distribution identity');
  return identity;
}
