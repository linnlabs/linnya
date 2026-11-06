import { describe, expect, it } from 'vitest';

import {
  formatDataUpgradeProgressStyle,
  renderDataUpgradePage,
  selectDataUpgradeCopy,
} from '../functions/renderDataUpgradePage';

describe('data upgrade page', () => {
  it('中文系统用中文，其余系统用英文', () => {
    expect(selectDataUpgradeCopy('zh-CN').title).toBe('正在升级数据');
    expect(selectDataUpgradeCopy('zh-TW').title).toBe('正在升级数据');
    expect(selectDataUpgradeCopy('en-US').title).toBe('Upgrading your data');
    expect(selectDataUpgradeCopy('ja').title).toBe('Upgrading your data');
  });

  it('页面无脚本，只允许内联样式，并带品牌标记与进度条', () => {
    const html = renderDataUpgradePage({ copy: selectDataUpgradeCopy('zh-CN'), fraction: 0.5 });
    expect(html).not.toContain('<script');
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
    expect(html).toContain('--progress: 0.5;');
    expect(html).toContain('fill="#49A55C"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('进度限制在 0–1 之间', () => {
    expect(formatDataUpgradeProgressStyle(1.4)).toBe('html:root{--progress:1}');
    expect(formatDataUpgradeProgressStyle(-1)).toBe('html:root{--progress:0}');
    expect(formatDataUpgradeProgressStyle(Number.NaN)).toBe('html:root{--progress:0}');
  });
});
