import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const iconStyles = readFileSync(new URL('../src/styles/icons.css', import.meta.url), 'utf8');

const DEFAULT_SIZE_SELECTOR = ':where(.linnya-ui-icon:not([width], [height]))';

describe('图标默认尺寸', () => {
  it('没有显式尺寸的图标默认 1em，规则零优先级且不覆盖自带 width / height 属性的图标', () => {
    const rule = iconStyles.match(/:where\(\.linnya-ui-icon:not\(\[width\], \[height\]\)\)\s*\{([^}]*)\}/u);
    expect(rule).not.toBeNull();
    const declarations = (rule?.[1] ?? '').split(';').map(item => item.trim()).filter(Boolean);
    expect(declarations).toEqual(['width: 1em', 'height: 1em']);
    expect(iconStyles.split(DEFAULT_SIZE_SELECTOR)).toHaveLength(2);
  });

  it('默认规则排在 --em / --full / --fit 之前：同为零优先级时由后者按顺序覆盖', () => {
    const defaultIndex = iconStyles.indexOf(DEFAULT_SIZE_SELECTOR);
    expect(defaultIndex).toBeGreaterThanOrEqual(0);
    for (const variant of ['--em', '--full', '--fit']) {
      const variantIndex = iconStyles.indexOf(`:where(.shared-icon${variant})`);
      expect(variantIndex).toBeGreaterThan(defaultIndex);
    }
  });
});
