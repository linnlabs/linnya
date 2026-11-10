/**
 * 可读对话搜索的候选条件。索引用 detail=none，不支持短语查询：候选消息须同时含有查询的全部三字组，
 * 是否真的命中由调用方再做字面比较。规则与项目文件 grep 相同。
 */
export const READABLE_CONVERSATION_MAX_QUERY_GRAMS = 16;

export function buildReadableConversationMatch(query: string): string | null {
  const codePoints = Array.from(query.toLowerCase());
  if (codePoints.length < 3) return null;
  const grams = new Set<string>();
  for (let index = 0; index <= codePoints.length - 3; index += 1) {
    grams.add(codePoints.slice(index, index + 3).join(''));
    if (grams.size >= READABLE_CONVERSATION_MAX_QUERY_GRAMS) break;
  }
  return [...grams].map(gram => `"${gram.replace(/"/g, '""')}"`).join(' AND ');
}
