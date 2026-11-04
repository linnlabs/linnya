import { canvasTextGraphemes } from './canvasTextGraphemes';

/** 按完整grapheme拟合单行显示文字；canonical全文仍供悬停与Agent读取。 */
export function canvasFitText(text: string, measure: (text: string) => number, width = 200): string {
  if (measure(text) <= width) return text;
  if (measure('…') > width) return '';
  const graphemes = Array.from(canvasTextGraphemes(text)); let low = 0, high = graphemes.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(graphemes.slice(0, middle).join('') + '…') <= width) low = middle;
    else high = middle - 1;
  }
  return graphemes.slice(0, low).join('') + '…';
}
