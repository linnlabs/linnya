import { describe, expect, it } from 'vitest';

import { shouldAllowRendererPermission } from './rendererPermissionPolicy';

describe('renderer permission policy', () => {
  it('允许桌面端真实需要的渲染进程权限', () => {
    expect(shouldAllowRendererPermission('media')).toBe(true);
    expect(shouldAllowRendererPermission('audioCapture')).toBe(true);
    expect(shouldAllowRendererPermission('clipboard-sanitized-write')).toBe(true);
  });

  it('拒绝剪贴板读取和其他无关权限', () => {
    expect(shouldAllowRendererPermission('clipboard-read')).toBe(false);
    expect(shouldAllowRendererPermission('geolocation')).toBe(false);
    expect(shouldAllowRendererPermission('openExternal')).toBe(false);
  });
});
