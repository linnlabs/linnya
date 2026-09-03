import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../../shared/distribution-identity';
import { isOfficialPluginRemoteServiceEnabled } from './isOfficialPluginRemoteServiceEnabled';

describe('isOfficialPluginRemoteServiceEnabled', () => {
  it('只允许 official 发行身份连接官方插件远程服务', () => {
    expect(isOfficialPluginRemoteServiceEnabled(createSourceDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createCommunityDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'fixture',
    }))).toBe(true);
  });
});
