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

  it('页面无脚本，只允许内联样式，并带摇曳标识与进度条', () => {
    const html = renderDataUpgradePage({ copy: selectDataUpgradeCopy('zh-CN'), fraction: 0.5 });
    expect(html).not.toContain('<script');
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
    expect(html).toContain('--progress: 0.5;');
    expect(html).toContain('fill: #49A55C;');
    expect(html).toMatch(/<g class="plant"><path d="[^"]+"\/><path class="leaf-left" d="[^"]+"\/><path class="leaf-right" d="[^"]+"\/><\/g>/);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('轨道用同色系浅绿，流光只画在已完成段上', () => {
    const html = renderDataUpgradePage({ copy: selectDataUpgradeCopy('en-US'), fraction: 0 });
    expect(html).toContain('--track: #e1f3e6;');
    expect(html).toContain('--track: color-mix(in srgb, #49a55c 20%, #171717);');
    expect(html).not.toContain('class="sheen"');
    expect(html).toMatch(/\.fill \{[^}]*background-image: linear-gradient\(90deg, rgb\(255 255 255 \/ calc\(var\(--sheen\) \* 0\)\) 0%/);
    expect(html).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.plant, \.leaf-left, \.leaf-right, \.fill \{ animation: none; \}/);
  });

  it('进度限制在 0–1 之间', () => {
    expect(formatDataUpgradeProgressStyle(1.4)).toBe('html:root{--progress:1}');
    expect(formatDataUpgradeProgressStyle(-1)).toBe('html:root{--progress:0}');
    expect(formatDataUpgradeProgressStyle(Number.NaN)).toBe('html:root{--progress:0}');
  });
});
