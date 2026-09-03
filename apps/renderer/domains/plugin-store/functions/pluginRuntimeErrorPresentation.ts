import type { MessageParams } from '@app/localization';
import {
  isPluginRuntimeError,
  type PluginRuntimeErrorCode,
  type PluginRuntimeUserError,
} from '@/app/plugins/definitions/pluginRuntimeErrors';
import type { PluginStoreMessageKey, PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';

const PLUGIN_RUNTIME_ERROR_MESSAGE_KEYS = {
  pluginStateResponseInvalid: 'pluginStore.runtimeError.pluginStateResponseInvalid',
  pluginStateReadFailed: 'pluginStore.runtimeError.pluginStateReadFailed',
  pluginStateSchemaInvalid: 'pluginStore.runtimeError.pluginStateSchemaInvalid',
  pluginStoreListResponseInvalid: 'pluginStore.runtimeError.pluginStoreListResponseInvalid',
  pluginStoreListReadFailed: 'pluginStore.runtimeError.pluginStoreListReadFailed',
  pluginStoreListSchemaInvalid: 'pluginStore.runtimeError.pluginStoreListSchemaInvalid',
  pluginStoreDetailUnavailable: 'pluginStore.runtimeError.pluginStoreDetailUnavailable',
  pluginStoreDetailResponseInvalid: 'pluginStore.runtimeError.pluginStoreDetailResponseInvalid',
  pluginStoreDetailReadFailed: 'pluginStore.runtimeError.pluginStoreDetailReadFailed',
  pluginStoreDetailSchemaInvalid: 'pluginStore.runtimeError.pluginStoreDetailSchemaInvalid',
  pluginRemoteInstallResponseInvalid: 'pluginStore.runtimeError.pluginRemoteInstallResponseInvalid',
  pluginRemoteInstallFailed: 'pluginStore.runtimeError.pluginRemoteInstallFailed',
  pluginRemoteInstallSchemaInvalid: 'pluginStore.runtimeError.pluginRemoteInstallSchemaInvalid',
  pluginRemoteUpdateCheckResponseInvalid: 'pluginStore.runtimeError.pluginRemoteUpdateCheckResponseInvalid',
  pluginRemoteUpdateCheckFailed: 'pluginStore.runtimeError.pluginRemoteUpdateCheckFailed',
  pluginRemoteUpdateCheckSchemaInvalid: 'pluginStore.runtimeError.pluginRemoteUpdateCheckSchemaInvalid',
  pluginDiagnosticsResponseInvalid: 'pluginStore.runtimeError.pluginDiagnosticsResponseInvalid',
  pluginDiagnosticsReadFailed: 'pluginStore.runtimeError.pluginDiagnosticsReadFailed',
  pluginDiagnosticsSchemaInvalid: 'pluginStore.runtimeError.pluginDiagnosticsSchemaInvalid',
  pluginMutationResponseInvalid: 'pluginStore.runtimeError.pluginMutationResponseInvalid',
  pluginMutationFailed: 'pluginStore.runtimeError.pluginMutationFailed',
  pluginRemoteUpdateCheckUnsupported: 'pluginStore.runtimeError.pluginRemoteUpdateCheckUnsupported',
  pluginRemoteInstallUnsupported: 'pluginStore.runtimeError.pluginRemoteInstallUnsupported',
  pluginUninstallUnsupported: 'pluginStore.runtimeError.pluginUninstallUnsupported',
  pluginToggleUnsupported: 'pluginStore.runtimeError.pluginToggleUnsupported',
} as const satisfies Readonly<Record<PluginRuntimeErrorCode, PluginStoreMessageKey>>;

function buildPluginRuntimeErrorParams(error: PluginRuntimeUserError): MessageParams | undefined {
  if (!isPluginRuntimeError(error) || error.pluginId === undefined) {
    return undefined;
  }
  return { pluginId: error.pluginId };
}

export function resolvePluginRuntimeUserErrorMessage(
  error: PluginRuntimeUserError,
  resolveMessage: PluginStoreMessageResolver,
): string {
  if (typeof error === 'string') {
    return resolveMessage('pluginStore.error.unknown');
  }

  return resolveMessage(
    PLUGIN_RUNTIME_ERROR_MESSAGE_KEYS[error.code],
    buildPluginRuntimeErrorParams(error),
  );
}
