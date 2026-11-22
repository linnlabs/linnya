import type { PluginRemoteCatalogItem, PluginStoreListItem } from '@app/schemas';
import { describe, expect, it } from 'vitest';

import { createPluginRuntimeError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import { PLUGIN_STORE_MESSAGE_FALLBACKS } from '../definitions/pluginStoreMessageCatalog';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import {
  canRetryRemoteFailure,
  hasRemoteUpdate,
  resolveRemoteFailureMessage,
  resolveRemoteFailureShortMessage,
  resolveRuntimeDisplayName,
  toRemoteOnlyStoreItem,
} from './pluginRemoteInstallPresentation';

const resolveMessage: PluginStoreMessageResolver = (key, params) =>
  PLUGIN_STORE_MESSAGE_FALLBACKS[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`));

const remote = (version: string, availability: PluginRemoteCatalogItem['availability'] = { status: 'installable', downloadBytes: 1, unpackedBytes: 2, runtimes: [] }): PluginRemoteCatalogItem => ({
  id: 'knowledge', name: '知识库', version, description: '资料', developer: 'Linnya', availability,
});

const installed = (version: string, state: PluginStoreListItem['state'] = 'enabled'): PluginStoreListItem => ({
  ...toRemoteOnlyStoreItem(remote(version)),
  state,
});

describe('远程安装展示规则', () => {
  it('只有已安装且 catalog 可装版本更高时才算有新版本', () => {
    expect(hasRemoteUpdate(installed('0.2.0'), remote('0.2.1'))).toBe(true);
    expect(hasRemoteUpdate(installed('0.2.0'), remote('0.2.0'))).toBe(false);
    expect(hasRemoteUpdate(installed('0.3.0'), remote('0.2.9'))).toBe(false);
    expect(hasRemoteUpdate(installed('0.2.0', 'missing'), remote('0.3.0'))).toBe(false);
    expect(hasRemoteUpdate(installed('0.2.0'), remote('0.3.0', { status: 'requires-app-update', minApp: '9.0.0' }))).toBe(false);
    expect(hasRemoteUpdate(installed('0.2.0'), undefined)).toBe(false);
  });

  it('更新已激活、等待重启时按已安装版本比较，不再显示同一个更新', () => {
    const pending = (installedVersion: string): PluginStoreListItem => ({ ...installed('0.2.0'), pendingRestartVersion: installedVersion });
    expect(hasRemoteUpdate(pending('0.2.1'), remote('0.2.1'))).toBe(false);
    expect(hasRemoteUpdate(pending('0.2.1'), remote('0.2.2'))).toBe(true);
    expect(hasRemoteUpdate(pending('0.3.0'), remote('0.2.9'))).toBe(false);
  });

  it('catalog-only 条目不是随包插件，状态为未安装', () => {
    expect(toRemoteOnlyStoreItem(remote('0.2.0'))).toMatchObject({ state: 'missing', meta: { id: 'knowledge', builtin: false } });
  });

  it('失败的简短原因与完整说明：磁盘空间写明数字；需要更新 Linnya 不提供重试', () => {
    const disk = createPluginRuntimeError('pluginOperationDiskSpace', { diskSpace: { requiredBytes: 100, availableBytes: 35 } });
    expect(resolveRemoteFailureShortMessage(disk, resolveMessage)).toBe('磁盘空间不足，请在详情页重试');
    expect(resolveRemoteFailureMessage({ error: disk, pluginName: '知识库', remote: undefined, resolveMessage, formatBytes: bytes => `${bytes}B` }))
      .toBe('磁盘空间不足：安装需要约 100B 可用空间，当前剩余 35B。释放空间后重试。');

    const incompatible = createPluginRuntimeError('pluginOperationIncompatible');
    expect(canRetryRemoteFailure(incompatible)).toBe(false);
    expect(canRetryRemoteFailure(createPluginRuntimeError('pluginOperationNetwork'))).toBe(true);
    expect(resolveRemoteFailureMessage({
      error: incompatible, pluginName: '知识库', remote: remote('0.3.0', { status: 'requires-app-update', minApp: '0.4.0' }), resolveMessage, formatBytes: String,
    })).toBe('知识库 0.3.0 需要 Linnya 0.4.0 或更高版本。请先更新 Linnya。');

    expect(resolveRemoteFailureShortMessage(createPluginRuntimeError('pluginOperationVersionConflict'), resolveMessage))
      .toBe('安装没有完成，请在详情页重试');
  });

  it('运行时组件名：已知 ID 用产品名称，未知 ID 用通用名称', () => {
    expect(resolveRuntimeDisplayName('qdrant', resolveMessage)).toBe('向量检索组件');
    expect(resolveRuntimeDisplayName('something-new', resolveMessage)).toBe('运行时组件');
  });
});
