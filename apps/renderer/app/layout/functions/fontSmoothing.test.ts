import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FONT_SMOOTHING_ATTRIBUTE,
  applyFontSmoothingToDom,
  resolveFontSmoothingAttribute,
} from './fontSmoothing';

describe('fontSmoothing', () => {
  it('开启对应 on，关闭对应 off', () => {
    expect(resolveFontSmoothingAttribute(true)).toBe('on');
    expect(resolveFontSmoothingAttribute(false)).toBe('off');
  });

  it('把属性写到根元素上', () => {
    const calls: Array<[string, string]> = [];
    const root = { setAttribute: (name: string, value: string) => { calls.push([name, value]); } };
    applyFontSmoothingToDom(false, root);
    applyFontSmoothingToDom(true, root);
    expect(calls).toEqual([
      [FONT_SMOOTHING_ATTRIBUTE, 'off'],
      [FONT_SMOOTHING_ATTRIBUTE, 'on'],
    ]);
  });

  it('reset.css 只在属性不是 off 时开启 antialiased，关闭时回到 auto', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/base/reset.css'), 'utf8');
    expect(css).toContain(`html:not([${FONT_SMOOTHING_ATTRIBUTE}='off'])`);
    expect(css).toContain('-webkit-font-smoothing: antialiased;');
    expect(css).toContain(`html[${FONT_SMOOTHING_ATTRIBUTE}='off']`);
    expect(css).toContain('-webkit-font-smoothing: auto;');
  });
});
