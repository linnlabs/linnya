function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * 中文备注：
 * - 这里集中收口“工具输出如何投影为最终答案”的显式规则；
 * - ToolNode 只解释通用 `control.finalAnswer`，不绑定任何宿主/产品工具名。
 */
export function resolveFinalAnswerFromToolControl(finalAnswer: unknown): string | undefined {
  return readNonEmptyString(finalAnswer);
}
