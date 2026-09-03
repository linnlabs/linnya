import { describe, expect, it } from 'vitest';

import {
  createCommunityDistributionIdentity,
  createDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from './createDistributionIdentity';

describe('DistributionIdentity', () => {
  it('创建源码、社区和官方三种冻结身份', () => {
    const source = createSourceDistributionIdentity();
    const community = createCommunityDistributionIdentity();
    const official = createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: 'desktop-release-2026',
    });

    expect(source).toEqual({ kind: 'source', packaged: false });
    expect(community).toEqual({ kind: 'community', packaged: true });
    expect(official).toEqual({
      kind: 'official',
      packaged: true,
      releaseChannel: 'stable',
      releaseKeyId: 'desktop-release-2026',
    });
    expect([source, community, official].every(Object.isFrozen)).toBe(true);
  });

  it('严格拒绝不一致的打包事实和空 key ID', () => {
    expect(() => createDistributionIdentity({ kind: 'source', packaged: true })).toThrow(
      'source distribution 不能标记为 packaged'
    );
    expect(() => createOfficialDistributionIdentity({
      releaseChannel: 'stable',
      releaseKeyId: ' ',
    })).toThrow('缺少 release key ID');
  });
});
