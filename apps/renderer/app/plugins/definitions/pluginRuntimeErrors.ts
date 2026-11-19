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

export type PluginRuntimeUserError = string | PluginRuntimeError;



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
      unknown: 'pluginOperationUnknown',
    } as const;
    return new PluginRuntimeError(codeByOperation[caught.code], { pluginId: caught.pluginId });
  }
  return caught instanceof Error ? caught.message : String(caught);
}
