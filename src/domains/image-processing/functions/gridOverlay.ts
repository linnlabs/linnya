/** 列号从 0 起，行号从 A 起；最多 26 行，够用且模型读得清。 */
export const MAX_GRID_DIVISIONS = 26;

export function gridRowLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * 叠在图上的坐标网格：n×n 等分线加行列号，线和字都描一圈白边，深浅底上都看得清。
 * 只用通用无衬线字体写 0–9、A–Z，不依赖下载字体。
 */
export function gridOverlaySvg(width: number, height: number, divisions: number): string {
  const lines: string[] = [];
  for (let i = 1; i < divisions; i += 1) {
    const x = (width * i) / divisions;
    const y = (height * i) / divisions;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`, `<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
  }
  const fontSize = Math.max(11, Math.round(Math.min(width, height) / divisions / 4));
  const labels: string[] = [];
  for (let i = 0; i < divisions; i += 1) {
    const cellLeft = (width * i) / divisions;
    const cellTop = (height * i) / divisions;
    labels.push(
      `<text x="${cellLeft + 4}" y="${fontSize + 2}">${i}</text>`,
      `<text x="4" y="${cellTop + fontSize * 2 + 4}">${gridRowLabel(i)}</text>`,
    );
  }
  const stroke = Math.max(1, Math.round(Math.min(width, height) / 800));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<g stroke="#ffffff" stroke-opacity="0.7" stroke-width="${stroke * 3}">${lines.join('')}</g>`,
    `<g stroke="#e0115f" stroke-width="${stroke}">${lines.join('')}</g>`,
    `<g font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="#e0115f" stroke="#ffffff" stroke-width="${Math.max(2, fontSize / 5)}" paint-order="stroke">${labels.join('')}</g>`,
    '</svg>',
  ].join('');
}
