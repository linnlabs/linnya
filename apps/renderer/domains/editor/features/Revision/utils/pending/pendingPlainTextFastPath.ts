import type { PendingContentBlockResolution } from './pendingRevisionHelpers'

export function canResolvePendingMarkdownAsPlainTextFastPath(markdown: string): boolean {
  const normalized = markdown.replace(/\r\n/g, '\n')

  if (normalized.includes('\n')) return false
  if (/^\s*(?:#{1,6}\s|[-*+]\s+|\d+\.\s+|>\s+|---+\s*$)/.test(normalized)) return false

  // 中文说明：
  // `#` 和裸 `[]()` 在行内通常只是普通文本，压测与真实文档里经常出现
  // “测试块 #1 [AI修订 #1]”这类内容。只有真的形成 Markdown 语义时才回退 runtime，
  // 避免大文档 pending 懒投影把普通文本误送进 WASM 解析热路径。
  if (/[`*_~!<>|\\$]/.test(normalized)) return false
  if (/!\[/.test(normalized)) return false
  if (/\[[^\]]*\]\s*\(/.test(normalized)) return false
  if (/\[[^\]]*\]\s*\[/.test(normalized)) return false
  if (/\[\^/.test(normalized)) return false

  return true
}

export function resolvePlainTextMarkdownFastPath(
  markdown: string
): PendingContentBlockResolution | null {
  const normalized = typeof markdown === 'string' ? markdown.replace(/\r\n/g, '\n') : ''

  // 中文说明：
  // - pending 懒投影会在滚动时频繁处理普通文本块；
  // - 对“确定没有 Markdown 结构”的单行纯文本，进入 WASM StreamingParser 是纯成本；
  // - 这里必须保守，任何可能改变语义的字符都交回 runtime 统一解析。
  if (!canResolvePendingMarkdownAsPlainTextFastPath(normalized)) return null

  return {
    kind: 'content-block',
    contentType: 'baseBlock',
    blockAttrs: {},
    cleanMarkdown: normalized,
    spans: normalized.length > 0 ? [{ text: normalized, marks: [] }] : [],
    source: 'plain-text-fast-path',
  }
}
