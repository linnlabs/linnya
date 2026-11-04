/** 按Unicode码点拟合单行显示文字；canonical全文仍供悬停与Agent读取。 */
export function canvasFitText(text: string, measure: (text: string) => number, width = 200): string {
  if (measure(text) <= width) return text;
  if (measure('…') > width) return '';
  const points = Array.from(text); let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(points.slice(0, middle).join('') + '…') <= width) low = middle;
    else high = middle - 1;
  }
  return points.slice(0, low).join('') + '…';
}
