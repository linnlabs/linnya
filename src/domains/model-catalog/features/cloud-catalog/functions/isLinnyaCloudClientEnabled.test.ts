import { describe, expect, it } from 'vitest';

import { isLinnyaCloudClientEnabled } from './isLinnyaCloudClientEnabled';

describe('isLinnyaCloudClientEnabled', () => {
  it('源码开发模式关闭 Cloud 客户端能力', () => {
    expect(isLinnyaCloudClientEnabled({ LINNYA_DEV_MODE: 'true' })).toBe(false);
  });

  it('发布运行环境保留未来的 Cloud 接入入口', () => {
    expect(isLinnyaCloudClientEnabled({})).toBe(true);
    expect(isLinnyaCloudClientEnabled({ LINNYA_DEV_MODE: 'false' })).toBe(true);
  });
});
