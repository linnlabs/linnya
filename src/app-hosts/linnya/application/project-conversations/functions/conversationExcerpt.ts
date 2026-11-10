import { PROJECT_CONVERSATIONS_EXCERPT_MAX_CHARS } from '@app/schemas';

/** 截取开头一段原文；按码点截断，不切开代理对。 */
export function clipConversationText(text: string, maxChars = PROJECT_CONVERSATIONS_EXCERPT_MAX_CHARS): string {
  const trimmed = text.trim();
  const codePoints = Array.from(trimmed);
  return codePoints.length <= maxChars ? trimmed : `${codePoints.slice(0, maxChars).join('').trimEnd()}…`;
}

/** 命中处前后各取一小段，压成一行，给搜索结果展示。找不到时返回 null。 */
export function excerptAroundMatch(text: string, query: string, radius = 40): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const index = flat.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
