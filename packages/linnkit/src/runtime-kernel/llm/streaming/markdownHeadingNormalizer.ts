/**
 * @file src/agent/runtime-kernel/llm/streaming/markdownHeadingNormalizer.ts
 * @description
 * Markdown 增量拼接辅助：确保标题在流式 thought 拼接下仍能被正确识别。
 *
 * 背景：
 * - 模型在 thought 增量中可能突然输出 `### 标题` / `##标题`；
 * - 若前一段末尾没有换行，直接拼接会变成 `上一行内容### 标题`，markdown 解析不会识别为 heading。
 *
 * 策略（保守）：
 * - 仅当 incoming 看起来是 heading 且 buffer 末尾不是换行时，补一个 `\n`。
 * - 不改变非 heading 的增量，避免影响普通文本。
 */

export function normalizeThoughtDeltaForMarkdown(buffer: string, incoming: string): string {
  const chunk = String(incoming ?? '');
  if (!chunk) return chunk;
  if (!buffer) return chunk;

  // 已经在新行开始（或前面就是换行），无需处理
  if (buffer.endsWith('\n')) return chunk;
  if (chunk.startsWith('\n')) return chunk;

  // 识别 `### 标题` / `##标题`（不强制要求 # 后有空格）
  const looksLikeHeading = /^#{1,6}(?:\s|[^\s#])/.test(chunk);
  if (!looksLikeHeading) return chunk;

  return `\n${chunk}`;
}

