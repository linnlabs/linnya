function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
}
/** 封面是只读摘要，不嵌入活动 HTML 或递归文档预览。详情交给标准 Markdown renderer。 */
export function createMarkdownCover(markdown: string, widthPx: number) {
  const heightPx = Math.round(widthPx * 0.625);
  const lines = markdown.split('\n').filter(line => line.trim()).slice(0, 8);
  const lineHeight = heightPx / 11;
  const body = lines.map((line, index) => `<text x="24" y="${32 + index * lineHeight}" font-size="${index === 0 ? 22 : 16}" fill="#292524">${escape(line.slice(0, 72))}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><rect width="100%" height="100%" fill="#fafaf9"/>${body}</svg>`;
  return { dataUri: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), widthPx, heightPx };
}
