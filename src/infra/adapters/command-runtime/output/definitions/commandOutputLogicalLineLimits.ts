export interface CommandOutputLogicalLineLimits {
  /** 尚未由 LF/EOF 提交的单行，最多保留多少个 JavaScript UTF-16 单位。 */
  readonly maxCharactersPerCurrentLine: number;
}

/**
 * 当前行必须同时保留开头和错误尾部，因此至少需要各两个 UTF-16 单位。
 * 生产值由后续输出策略注入，本层不复制 Agent preview 或 ToolOutputStore 的配置。
 */
export function validateCommandOutputLogicalLineLimits(
  limits: CommandOutputLogicalLineLimits,
): CommandOutputLogicalLineLimits {
  if (
    !Number.isSafeInteger(limits.maxCharactersPerCurrentLine)
    || limits.maxCharactersPerCurrentLine < 4
  ) {
    throw new Error(
      'command output maxCharactersPerCurrentLine must be a safe integer of at least 4',
    );
  }
  return Object.freeze({
    maxCharactersPerCurrentLine: limits.maxCharactersPerCurrentLine,
  });
}
