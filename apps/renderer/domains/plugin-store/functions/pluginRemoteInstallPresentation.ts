import {
  compareDottedVersions,
  type PluginRemoteCatalogItem,
  type PluginStoreListItem,
} from '@app/schemas';

import type { PluginRuntimeUserError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import type { PluginStoreMessageKey, PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import { resolvePluginRuntimeUserErrorMessage } from './pluginRuntimeErrorPresentation';

/** 只在 catalog 中、本机从未登记的插件：用 catalog 展示字段构造商店条目，安装后以下载内容中的 plugin.json 为准。 */
export function toRemoteOnlyStoreItem(item: PluginRemoteCatalogItem): PluginStoreListItem {
  return {
    meta: {
      id: item.id,
      name: item.name,
      version: item.version,
      description: item.description,
      developer: item.developer,
      builtin: false,
      ...(item.permissions ? { permissions: item.permissions } : {}),
    },
    state: 'missing',
  };
}

export function isRemoteInstallable(item: PluginRemoteCatalogItem | undefined): boolean {
  return item?.availability.status === 'installable';
}

/** 已安装插件且 catalog 中可装的版本更高：显示“有新版本”与更新按钮。 */
export function hasRemoteUpdate(item: PluginStoreListItem, remote: PluginRemoteCatalogItem | undefined): boolean {
  if (!remote || item.state === 'missing' || !isRemoteInstallable(remote)) return false;
  // 已更新、等待重启的插件按已安装版本比较；meta.version 仍是运行中的旧版本。
  return compareDottedVersions(item.pendingRestartVersion ?? item.meta.version, remote.version) === -1;
}

const FAILURE_SHORT_KEYS: Partial<Record<PluginRuntimeUserError['code'], PluginStoreMessageKey>> = {
  pluginOperationNetwork: 'pluginStore.remote.failureShort.network',
  pluginOperationArtifactIntegrity: 'pluginStore.remote.failureShort.integrity',
  pluginOperationDiskSpace: 'pluginStore.remote.failureShort.diskSpace',
  pluginOperationSourceUnavailable: 'pluginStore.remote.failureShort.service',
  pluginOperationIncompatible: 'pluginStore.remote.failureShort.incompatible',
};

/** 列表卡片只放一句原因，完整说明与操作在详情页。 */
export function resolveRemoteFailureShortMessage(error: PluginRuntimeUserError, resolveMessage: PluginStoreMessageResolver): string {
  return resolveMessage('pluginStore.remote.failureCard', {
    reason: resolveMessage(FAILURE_SHORT_KEYS[error.code] ?? 'pluginStore.remote.failureShort.unknown'),
  });
}

/** 需要更新 Linnya 的失败重试没有意义；其余失败都可以重试。 */
export function canRetryRemoteFailure(error: PluginRuntimeUserError): boolean {
  return error.code !== 'pluginOperationIncompatible';
}

export function resolveRemoteFailureMessage(input: {
  readonly error: PluginRuntimeUserError;
  readonly pluginName: string;
  readonly remote: PluginRemoteCatalogItem | undefined;
  readonly resolveMessage: PluginStoreMessageResolver;
  readonly formatBytes: (bytes: number) => string;
}): string {
  const { error, resolveMessage } = input;
  switch (error.code) {
    case 'pluginOperationDiskSpace':
      return error.diskSpace
        ? resolveMessage('pluginStore.remote.failure.diskSpace', {
          required: input.formatBytes(error.diskSpace.requiredBytes),
          available: input.formatBytes(error.diskSpace.availableBytes),
        })
        : resolvePluginRuntimeUserErrorMessage(error, resolveMessage);
    case 'pluginOperationArtifactIntegrity':
      return resolveMessage('pluginStore.remote.failure.integrity');
    case 'pluginOperationSourceUnavailable':
      return resolveMessage('pluginStore.remote.failure.service');
    case 'pluginOperationIncompatible':
      return input.remote?.availability.status === 'requires-app-update'
        ? resolveMessage('pluginStore.remote.failure.requiresAppUpdate', {
          pluginName: input.pluginName,
          version: input.remote.version,
          minApp: input.remote.availability.minApp,
        })
        : resolvePluginRuntimeUserErrorMessage(error, resolveMessage);
    default:
      return resolvePluginRuntimeUserErrorMessage(error, resolveMessage);
  }
}

/** Host 通用运行时 ID 的展示名；未知 ID 用通用名称，不让界面出现空白。 */
export function resolveRuntimeDisplayName(runtimeId: string, resolveMessage: PluginStoreMessageResolver): string {
  return runtimeId === 'qdrant'
    ? resolveMessage('pluginStore.runtime.qdrant')
    : resolveMessage('pluginStore.runtime.generic');
}
