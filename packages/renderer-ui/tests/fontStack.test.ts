import { describe, expect, it } from 'vitest';

import {
  formatCssFontFamilyStack,
  resolveBrowserFontStack,
} from '../src/features/font-stack/index.js';

describe('browser font stack', () => {
  it('为 Office 字体生成确定性的 Latin fallback 栈', () => {
    expect(resolveBrowserFontStack('Calibri Light')).toEqual({
      requestedFamily: 'Calibri Light',
      requestedPrimaryFamily: 'Calibri Light',
      primaryFamily: 'Calibri Light',
      resolvedFamily: '"Calibri Light", Calibri, "Helvetica Neue", Helvetica, Arial, sans-serif',
      fallbackFamilies: [
        'Calibri Light',
        'Calibri',
        'Helvetica Neue',
        'Helvetica',
        'Arial',
        'sans-serif',
      ],
    });
  });

  it('根据实际文本补充 CJK fallback，同时保持请求顺序并去重', () => {
    expect(resolveBrowserFontStack('"Noto Sans CJK SC", Arial', '林雅')).toEqual({
      requestedFamily: '"Noto Sans CJK SC", Arial',
      requestedPrimaryFamily: 'Noto Sans CJK SC',
      primaryFamily: 'Noto Sans CJK SC',
      resolvedFamily: '"Noto Sans CJK SC", Arial, "PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif',
      fallbackFamilies: [
        'Noto Sans CJK SC',
        'Arial',
        'PingFang SC',
        'Hiragino Sans GB',
        'Heiti SC',
        'Microsoft YaHei',
        'WenQuanYi Micro Hei',
        'sans-serif',
      ],
    });
  });

  it('只为含空格的字体名加引号，并提供稳定的默认字体栈', () => {
    expect(formatCssFontFamilyStack(['sans-serif', 'IBM Plex Sans', 'Arial']))
      .toBe('sans-serif, "IBM Plex Sans", Arial');
    expect(resolveBrowserFontStack()).toMatchObject({
      primaryFamily: 'Helvetica Neue',
      resolvedFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    });
  });
});
