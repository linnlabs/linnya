/** 按Unicode码点拟合显示标签；canonical全文仍供悬停与Agent读取。 */
export function canvasFitLineLabel(text: string, measure: (text: string) => number, width = 200): string {
  if (measure(text) <= width) return text;
  const points = Array.from(text); let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(points.slice(0, middle).join('') + '…') <= width) low = middle;
    else high = middle - 1;
  }
  return points.slice(0, low).join('') + '…';
}
