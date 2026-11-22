import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../../shared/distribution-identity';
import { isOfficialPluginRemoteServiceEnabled } from './isOfficialPluginRemoteServiceEnabled';

describe('isOfficialPluginRemoteServiceEnabled', () => {
  it('只有通过发行验签的官方 Desktop 连接官方插件服务；源码运行与社区打包不连接', () => {
    expect(isOfficialPluginRemoteServiceEnabled(createSourceDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createCommunityDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'fixture',
    }))).toBe(true);
  });
});
