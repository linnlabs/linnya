/**
 * 估算一份预览结果占用的内存：累加其中所有字符串的长度（UTF-16，每字符 2 字节）。
 * 不用 JSON.stringify 量大小：带内联图片的结果有几千万字符，为了量它再拼一份同样大的文本，
 * 页面会停顿几百毫秒。键名、数字和对象结构相对正文与图片可以忽略。
 */
export function estimateCanvasPreviewBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object' || value === null) return 0;
  const items: readonly unknown[] = Array.isArray(value) ? value : Object.values(value);
  let bytes = 0;
  for (const item of items) bytes += estimateCanvasPreviewBytes(item);
  return bytes;
}
