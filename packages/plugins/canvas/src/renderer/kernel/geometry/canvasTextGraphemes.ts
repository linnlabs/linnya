/// <reference lib="es2022.intl" />
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 浏览器负责组合字符与ZWJ序列的边界，不在Canvas里维护第二套Unicode规则。 */
export function* canvasTextGraphemes(text: string): Generator<string, void, unknown> {
  for (const { segment } of segmenter.segment(text)) yield segment;
}

/** 只读取显示所需的首行前缀；长正文不能先split/展开成整篇字符数组。 */
export function canvasTitlePrefix(text: string, limit: 18 | 120): string {
  let prefix = '', count = 0;
  for (const segment of canvasTextGraphemes(text)) {
    if (segment.includes('\n')) break;
    prefix += segment;
    if (++count === limit) break;
  }
  return prefix;
}
