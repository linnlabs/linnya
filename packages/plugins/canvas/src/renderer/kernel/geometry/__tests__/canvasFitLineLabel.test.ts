import { expect, it } from 'vitest';
import { canvasFitLineLabel } from '../canvasFitLineLabel';

it('长中文/emoji标签在显示上限内省略且不拆开Unicode码点，原始全文不改变', () => {
  const original = '😀中文'.repeat(300), measure = (text: string) => Array.from(text).length * 12;
  const fitted = canvasFitLineLabel(original, measure);
  expect(measure(fitted)).toBeLessThanOrEqual(200); expect(fitted.endsWith('…')).toBe(true);
  expect(fitted.isWellFormed()).toBe(true); expect(original).toBe('😀中文'.repeat(300));
  expect(canvasFitLineLabel('短标签😀', measure)).toBe('短标签😀');
});
