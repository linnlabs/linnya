import { isObjectLike } from '@linnya/foundation';
import { isPluginOperationFailure } from '@app/schemas';
import type { PluginId } from '@app/schemas';

export type PluginRuntimeErrorCode =
  | 'pluginStateResponseInvalid'
  | 'pluginStateReadFailed'
  | 'pluginStateSchemaInvalid'
  | 'pluginStoreListResponseInvalid'
  | 'pluginStoreListReadFailed'
  | 'pluginStoreListSchemaInvalid'
  | 'pluginStoreDetailUnavailable'
  | 'pluginStoreDetailResponseInvalid'
  | 'pluginStoreDetailReadFailed'
  | 'pluginStoreDetailSchemaInvalid'
  | 'pluginRemoteInstallResponseInvalid'
  | 'pluginRemoteInstallFailed'
  | 'pluginRemoteInstallSchemaInvalid'
  | 'pluginRemoteUpdateCheckResponseInvalid'
  | 'pluginRemoteUpdateCheckFailed'
  | 'pluginRemoteUpdateCheckSchemaInvalid'
  | 'pluginDiagnosticsResponseInvalid'
  | 'pluginDiagnosticsReadFailed'
  | 'pluginDiagnosticsSchemaInvalid'
  | 'pluginMutationResponseInvalid'
  | 'pluginMutationFailed'
  | 'pluginRemoteUpdateCheckUnsupported'
  | 'pluginRemoteInstallUnsupported'
  | 'pluginUninstallUnsupported'
  | 'pluginToggleUnsupported'
  | 'pluginOperationArtifactIntegrity'
  | 'pluginOperationVersionConflict'
  | 'pluginOperationMigrationFailed'
  | 'pluginOperationIncompatible'
  | 'pluginOperationDiskSpace'
  | 'pluginOperationSourceUnavailable'
  | 'pluginOperationActiveTool'
  | 'pluginOperationUnknown';

export interface PluginRuntimeErrorContext {
  readonly pluginId?: PluginId;
}

const PLUGIN_RUNTIME_ERROR_KIND = 'linnya.plugin-runtime-error';

function formatPluginRuntimeErrorMessage(
  code: PluginRuntimeErrorCode,
  context: PluginRuntimeErrorContext,
): string {
  if (context.pluginId === undefined) {
    return code;
  }
  return `${code}:${context.pluginId}`;
}

export class PluginRuntimeError extends Error {
  readonly kind = PLUGIN_RUNTIME_ERROR_KIND;
  readonly code: PluginRuntimeErrorCode;
  readonly pluginId?: PluginId;

  constructor(code: PluginRuntimeErrorCode, context: PluginRuntimeErrorContext = {}) {
    super(formatPluginRuntimeErrorMessage(code, context));
    this.name = 'PluginRuntimeError';
    this.code = code;
    this.pluginId = context.pluginId;
  }
}

export type PluginRuntimeUserError = PluginRuntimeError;

export function isPluginRuntimeError(value: unknown): value is PluginRuntimeError {
  return (
    isObjectLike(value) &&
    value.kind === PLUGIN_RUNTIME_ERROR_KIND &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

export function createPluginRuntimeError(
  code: PluginRuntimeErrorCode,
  context: PluginRuntimeErrorContext = {},
): PluginRuntimeError {
  return new PluginRuntimeError(code, context);
}

export function normalizePluginRuntimeUserError(caught: unknown): PluginRuntimeUserError {
  if (isPluginRuntimeError(caught)) {
    return caught;
  }
  if (isPluginOperationFailure(caught)) {
    const codeByOperation = {
      'artifact-integrity': 'pluginOperationArtifactIntegrity',
      'version-conflict': 'pluginOperationVersionConflict',
      'migration-failed': 'pluginOperationMigrationFailed',
      incompatible: 'pluginOperationIncompatible',
      'disk-space': 'pluginOperationDiskSpace',
      'source-unavailable': 'pluginOperationSourceUnavailable',
      'active-tool': 'pluginOperationActiveTool',
      unknown: 'pluginOperationUnknown',
    } as const;
    return new PluginRuntimeError(codeByOperation[caught.code], { pluginId: caught.pluginId });
  }
  // 原始异常可能包含路径、内部实现和服务端文案，不能穿透到用户界面。
  // 未结构化的异常统一落到 unknown，详细内容由 Host/Renderer 日志记录。
  return new PluginRuntimeError('pluginOperationUnknown');
}
