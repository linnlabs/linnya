/**
 * 在写回表格前，用当前业务单元的上下文替换输出占位符。
 * 上下文没有对应值时保留原占位符，避免静默丢失模型输出。
 */
export function replaceTableOutputPlaceholders(
  text: string,
  context: Readonly<Record<string, unknown>> | undefined,
): string {
  if (!text || !context) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, rawKey: string) => {
    const value = context[rawKey.trim()];
    return value === undefined || value === null ? match : String(value);
  });
}
