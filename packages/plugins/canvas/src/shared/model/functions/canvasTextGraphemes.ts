/// <reference lib="es2022.intl" />
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 由平台识别组合字符、旗帜和 ZWJ emoji，显示与正文投影共用同一边界。 */
export function* canvasTextGraphemes(text: string): Generator<string, void, unknown> {
  for (const { segment } of segmenter.segment(text)) yield segment;
}

/** 预算仍按 UTF-16 长度计算，但不能把最后一个可见字符切成半个。 */
export function canvasTextPrefix(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let prefix = '';
  for (const segment of canvasTextGraphemes(text)) {
    if (prefix.length + segment.length > limit) break;
    prefix += segment;
  }
  return prefix;
}
