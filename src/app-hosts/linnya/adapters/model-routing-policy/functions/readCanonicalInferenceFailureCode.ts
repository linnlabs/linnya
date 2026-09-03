function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Linnkit 对 canonical failure 的公开错误码带 `llm.` 命名空间。
 * 路由策略只消费这个稳定投影，不解析 message 或 Provider 原始 body。
 */
export function readCanonicalInferenceFailureCode(error: Error): string | undefined {
  if (!isRecord(error)) return undefined;
  const errorCode = error.errorCode;
  if (typeof errorCode !== 'string' || !errorCode.startsWith('llm.')) return undefined;
  return errorCode.slice('llm.'.length);
}
