import type { PluginDiskSpaceShortfall, PluginId, PluginOperationErrorCode } from '@app/schemas';

/**
 * 插件生命周期失败的内部错误合同。
 * 业务层在实际失败点标注类别，IPC 层只负责把稳定类别投影给 Renderer；
 * 原始 message 只用于诊断日志，不能依赖文案做分类。
 */
export class PluginOperationError extends Error {
  readonly code: PluginOperationErrorCode;
  readonly pluginId?: PluginId;
  readonly cause?: unknown;
  readonly diskSpace?: PluginDiskSpaceShortfall;

  constructor(
    code: PluginOperationErrorCode,
    message: string,
    options: {
      readonly pluginId?: PluginId;
      readonly cause?: unknown;
      readonly diskSpace?: PluginDiskSpaceShortfall;
    } = {},
  ) {
    super(message);
    this.name = 'PluginOperationError';
    this.code = code;
    this.pluginId = options.pluginId;
    this.cause = options.cause;
    if (options.diskSpace) this.diskSpace = options.diskSpace;
  }
}
function isNodeErrorWithCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code;
}

/** 将未标注的底层异常转换为稳定类别；只识别平台明确的磁盘空间错误。 */
export function toPluginOperationError(
  error: unknown,
  options: {
    readonly pluginId?: PluginId;
    readonly fallbackCode?: PluginOperationErrorCode;
  } = {},
): PluginOperationError {
  if (error instanceof PluginOperationError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const code = isNodeErrorWithCode(error, 'ENOSPC')
    ? 'disk-space'
    : options.fallbackCode ?? 'unknown';
  return new PluginOperationError(code, message, {
    pluginId: options.pluginId,
    cause: error,
  });
}
