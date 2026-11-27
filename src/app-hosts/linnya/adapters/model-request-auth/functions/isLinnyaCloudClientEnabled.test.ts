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

  it('Cloud 模型服务开放前，官方发行同样不连接', () => {
    expect(isLinnyaCloudClientEnabled(createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'fixture',
    }))).toBe(false);
  });
});
