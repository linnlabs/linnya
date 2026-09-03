export interface CommandOutputArtifactWriterLimits {
  readonly maxPendingEvents: number;
  readonly maxPendingBytes: number;
}

/**
 * 一条 execution 的 stdout/stderr 共用预算。4 MiB 可容纳 64 个常见 64 KiB 分片，
 * 条数上限同时阻止极小分片用对象数量绕过 byte 上限；它们都不是磁盘总输出配额。
 */
export const DEFAULT_COMMAND_OUTPUT_ARTIFACT_WRITER_LIMITS: CommandOutputArtifactWriterLimits = Object.freeze({
  maxPendingEvents: 1024,
  maxPendingBytes: 4 * 1024 * 1024,
});

export function validateCommandOutputArtifactWriterLimits(
  limits: CommandOutputArtifactWriterLimits,
): CommandOutputArtifactWriterLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`command output artifact ${name} must be a positive safe integer`);
    }
  }
  // 容量是 writer 生命周期不变量，不能跟随组合根随后修改同一个配置对象。
  return Object.freeze({
    maxPendingEvents: limits.maxPendingEvents,
    maxPendingBytes: limits.maxPendingBytes,
  });
}
