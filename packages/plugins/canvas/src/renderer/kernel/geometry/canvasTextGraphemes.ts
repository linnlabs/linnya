import { canvasTextGraphemes } from '../../../shared';
export { canvasTextGraphemes };

/** 只读取显示所需的首行前缀；长正文不能先split/展开成整篇字符数组。 */
export function canvasTitlePrefix(text: string, limit: 18 | 120): string {
  // UTF-16长度是grapheme数的上界；整串已能放进字数上限时无需分段，首行规则仍保留。
  if (text.length <= limit && !text.includes('\n')) return text;
  let prefix = '', count = 0;
  for (const segment of canvasTextGraphemes(text)) {
    if (segment.includes('\n')) break;
    prefix += segment;
    if (++count === limit) break;
  }
  return prefix;
}
