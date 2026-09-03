import type { ModelTokenLimits } from '../definitions/modelTokenLimits';

/**
 * 把设置表单中的 token 容量转换为 route 可接受的数字。
 *
 * 两个容量是模型 / Provider route 的独立事实。这里仅执行共享 schema 已规定的
 * “正安全整数”约束，不额外假设不同 Provider 的输入输出窗口关系。
 */
export function parseModelTokenLimits(
  contextWindowTokens: string,
  maxOutputTokens: string
): ModelTokenLimits | null {
  const contextWindow = Number(contextWindowTokens);
  const maxOutput = Number(maxOutputTokens);
  if (
    !Number.isSafeInteger(contextWindow) ||
    contextWindow <= 0 ||
    !Number.isSafeInteger(maxOutput) ||
    maxOutput <= 0
  ) {
    return null;
  }
  return {
    contextWindowTokens: contextWindow,
    maxOutputTokens: maxOutput,
  };
}
