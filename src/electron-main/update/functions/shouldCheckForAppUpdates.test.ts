import { describe, expect, it } from 'vitest';

import { shouldCheckForAppUpdates } from './shouldCheckForAppUpdates';

describe('shouldCheckForAppUpdates', () => {
  it('源码开发模式不请求正式发行服务', () => {
    expect(shouldCheckForAppUpdates({ LINNYA_DEV_MODE: 'true' })).toBe(false);
  });

  it('显式自动化开关可关闭更新检查', () => {
    expect(shouldCheckForAppUpdates({ LINNYA_DISABLE_UPDATE_CHECKS: '1' })).toBe(false);
  });

  it('发布态保留更新检查', () => {
    expect(shouldCheckForAppUpdates({})).toBe(true);
  });
});
