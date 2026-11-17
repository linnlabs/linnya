const OCR_PAGE_LIMIT_PATTERNS = [
  /当前 OCR 模型.+单次最多解析 \d+ 页/,
  /OCR model page cap/i,
];

export function isPdfOcrPageLimitMessage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const message = value.trim();
  if (!message) return false;
  return OCR_PAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}
