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
  | 'pluginToggleUnsupported';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

export function isPluginRuntimeError(value: unknown): value is PluginRuntimeError {
  return (
    isRecord(value) &&
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
  return caught instanceof Error ? caught.message : String(caught);
}
