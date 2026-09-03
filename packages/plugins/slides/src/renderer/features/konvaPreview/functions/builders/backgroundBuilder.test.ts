import { describe, expect, it } from 'vitest';
import { buildBackgroundRectConfig } from './backgroundBuilder';

describe('buildBackgroundRectConfig', () => {
  it('页面背景覆盖完整画布，不把预览外壳圆角写入页面像素', () => {
    const config = buildBackgroundRectConfig(
      { paint: { type: 'solid', color: '#F5EADB' } },
      { width: 1600, height: 900 },
    );

    expect(config).toMatchObject({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
      fill: '#F5EADB',
    });
    expect(config).not.toHaveProperty('cornerRadius');
  });
});
