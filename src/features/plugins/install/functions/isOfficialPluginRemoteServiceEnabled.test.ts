import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../../shared/distribution-identity';
import { isOfficialPluginRemoteServiceEnabled } from './isOfficialPluginRemoteServiceEnabled';

describe('isOfficialPluginRemoteServiceEnabled', () => {
  it('catalog 验签上线前，所有发行身份均关闭插件远程服务', () => {
    expect(isOfficialPluginRemoteServiceEnabled(createSourceDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createCommunityDistributionIdentity())).toBe(false);
    expect(isOfficialPluginRemoteServiceEnabled(createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'fixture',
    }))).toBe(false);
  });
});
