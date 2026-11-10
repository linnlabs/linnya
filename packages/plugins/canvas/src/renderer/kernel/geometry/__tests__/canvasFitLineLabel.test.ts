import { expect, it } from 'vitest';
import { canvasFitText } from '../canvasFitText';

it('长中文/emoji标签在显示上限内省略且不拆开完整字形组，原始全文不改变', () => {
  const original = '😀中文'.repeat(300), measure = (text: string) => Array.from(text).length * 12;
  const fitted = canvasFitText(original, measure);
  expect(measure(fitted)).toBeLessThanOrEqual(200); expect(fitted.endsWith('…')).toBe(true);
  expect(fitted.isWellFormed()).toBe(true); expect(original).toBe('😀中文'.repeat(300));
  expect(canvasFitText('短标签😀', measure)).toBe('短标签😀');
});

it('身份牌与线标签的宽度裁切不会留下半个ZWJ家庭、旗帜或失去音标的字母', () => {
  const measure = (text: string) => Array.from(text).length;
  expect(canvasFitText('👨‍👩‍👧‍👦后文', measure, 5)).toBe('…');
  expect(canvasFitText('🇨🇳后文', measure, 2)).toBe('…');
  expect(canvasFitText('e\u0301后文', measure, 2)).toBe('…');
  expect(canvasFitText('👨‍👩‍👧‍👦🇨🇳后文', measure, 10)).toBe('👨‍👩‍👧‍👦🇨🇳…');
});
