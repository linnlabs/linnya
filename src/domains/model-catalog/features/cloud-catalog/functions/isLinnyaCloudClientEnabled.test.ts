import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../../../shared/distribution-identity';
import { isLinnyaCloudClientEnabled } from './isLinnyaCloudClientEnabled';

describe('isLinnyaCloudClientEnabled', () => {
  it('源码和社区构建关闭 Cloud 客户端能力', () => {
    expect(isLinnyaCloudClientEnabled(createSourceDistributionIdentity())).toBe(false);
    expect(isLinnyaCloudClientEnabled(createCommunityDistributionIdentity())).toBe(false);
  });

  it('只有官方发行保留 Cloud 客户端接入边界', () => {
    expect(isLinnyaCloudClientEnabled(createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'fixture',
    }))).toBe(true);
  });
});
