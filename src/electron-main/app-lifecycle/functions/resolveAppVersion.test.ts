import { describe, expect, it } from 'vitest';

import { resolveAppVersion } from './resolveAppVersion';

describe('Desktop application version', () => {
  it('直接启动 Main bundle 时选择正式启动器的产品版本，而非 Electron 版本', () => {
    expect(resolveAppVersion({
      packaged: false,
      electronApplicationVersion: '43.4.0',
      developmentApplicationVersion: '0.0.38',
    })).toBe('0.0.38');
  });

  it('发布包使用自身版本，忽略外部 APP_VERSION', () => {
    expect(resolveAppVersion({
      packaged: true,
      electronApplicationVersion: '0.0.38',
      developmentApplicationVersion: '99.0.0',
    })).toBe('0.0.38');
  });

  it.each([undefined, '', '  '])('开发版本缺失时阻止启动，不回退到运行时版本：%s', version => {
    expect(() => resolveAppVersion({
      packaged: false,
      electronApplicationVersion: '43.4.0',
      developmentApplicationVersion: version,
    })).toThrow('源码运行缺少 APP_VERSION');
  });
});
