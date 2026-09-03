/** 避免 head 在 UTF-16 代理对中间结束。 */
export function findCommandTextUtf16SafePrefixEnd(
  text: string,
  maximumCharacters: number,
): number {
  const end = Math.min(text.length, maximumCharacters);
  if (end === 0 || end === text.length) return end;
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  const splitsSurrogatePair = previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff;
  return splitsSurrogatePair ? end - 1 : end;
}

/** 避免 tail 从 UTF-16 代理对中间开始；容量不足时丢弃整个 code point。 */
export function findCommandTextUtf16SafeSuffixStart(
  text: string,
  maximumCharacters: number,
): number {
  const target = Math.max(0, text.length - maximumCharacters);
  if (target === 0 || target === text.length) return target;
  const previous = text.charCodeAt(target - 1);
  const next = text.charCodeAt(target);
  const splitsSurrogatePair = previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff;
  return splitsSurrogatePair ? target + 1 : target;
}
