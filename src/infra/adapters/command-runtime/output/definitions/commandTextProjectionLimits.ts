export interface CommandTextProjectionLimits {
  /** 每条 stdout/stderr 流的 JavaScript UTF-16 单位上限。 */
  readonly maxCharactersPerStream: number;
  /** 每条 stdout/stderr 流的稳定文本行数上限。 */
  readonly maxLinesPerStream: number;
}

/**
 * head 与 tail 都必须至少有真实容量，否则“保留错误尾部”的产品合同无法成立。
 * 具体默认预算由 Agent output policy 注入，不能在底层复制 Linnkit 的配置真源。
 */
export function validateCommandTextProjectionLimits(
  limits: CommandTextProjectionLimits,
): CommandTextProjectionLimits {
  if (
    !Number.isSafeInteger(limits.maxCharactersPerStream)
    || limits.maxCharactersPerStream < 4
  ) {
    throw new Error(
      'command text projection maxCharactersPerStream must be a safe integer of at least 4',
    );
  }
  if (!Number.isSafeInteger(limits.maxLinesPerStream) || limits.maxLinesPerStream < 2) {
    throw new Error(
      'command text projection maxLinesPerStream must be a safe integer of at least 2',
    );
  }
  return Object.freeze({
    maxCharactersPerStream: limits.maxCharactersPerStream,
    maxLinesPerStream: limits.maxLinesPerStream,
  });
}
