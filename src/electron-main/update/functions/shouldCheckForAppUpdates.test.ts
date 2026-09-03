import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../shared/distribution-identity';
import { shouldCheckForAppUpdates } from './shouldCheckForAppUpdates';

describe('shouldCheckForAppUpdates', () => {
  it('源码和社区打包都不请求正式发行服务', () => {
    expect(shouldCheckForAppUpdates(createSourceDistributionIdentity(), {})).toBe(false);
    expect(shouldCheckForAppUpdates(createCommunityDistributionIdentity(), {})).toBe(false);
  });

  it('显式自动化开关可关闭更新检查', () => {
    expect(shouldCheckForAppUpdates(
      createOfficialDistributionIdentity({ releaseChannel: 'stable', releaseKeyId: 'fixture' }),
      { LINNYA_DISABLE_UPDATE_CHECKS: '1' },
    )).toBe(false);
  });

  it('只有官方发行态保留更新检查', () => {
    expect(shouldCheckForAppUpdates(
      createOfficialDistributionIdentity({ releaseChannel: 'stable', releaseKeyId: 'fixture' }),
      {},
    )).toBe(true);
  });
});
