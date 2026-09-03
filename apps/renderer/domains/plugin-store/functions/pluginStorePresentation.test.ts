import { describe, expect, it } from 'vitest';
import type { PluginStoreListItem } from '@app/schemas';
import {
  canCheckPluginUpdateFromRemote,
  canInstallPluginFromRemote,
  canTogglePlugin,
  canUninstallPlugin,
  getPluginStateLabel,
  getPluginStateTone,
  getPluginToggleDisabledReason,
  isRequiredPlugin,
} from './pluginStorePresentation';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import { PLUGIN_STORE_MESSAGE_FALLBACKS } from '../definitions/pluginStoreMessageCatalog';

const pluginStoreMessage: PluginStoreMessageResolver = (key) => PLUGIN_STORE_MESSAGE_FALLBACKS[key];

function createPluginItem(options: {
  id: string;
  state: PluginStoreListItem['state'];
  required?: boolean;
  reason?: string;
}): PluginStoreListItem {
  return {
    meta: {
      id: options.id,
      name: options.id,
      version: '1.0.0',
      description: `${options.id} description`,
      developer: 'Linnya',
      builtin: true,
      required: options.required,
    },
    state: options.state,
    reason: options.reason,
  };
}

describe('pluginStorePresentation', () => {
  it('maps install states to labels and tones', () => {
    expect(getPluginStateLabel('enabled', pluginStoreMessage)).toBe('已启用');
    expect(getPluginStateLabel('disabled', pluginStoreMessage)).toBe('已停用');
    expect(getPluginStateLabel('missing', pluginStoreMessage)).toBe('未安装');

    expect(getPluginStateTone('enabled')).toBe('success');
    expect(getPluginStateTone('disabled')).toBe('neutral');
    expect(getPluginStateTone('missing')).toBe('warning');
  });

  it('prevents required plugins from being toggled', () => {
    const item = createPluginItem({ id: 'platform', state: 'enabled', required: true });

    expect(isRequiredPlugin(item)).toBe(true);
    expect(canTogglePlugin(item)).toBe(false);
    expect(canUninstallPlugin(item)).toBe(false);
    expect(canInstallPluginFromRemote(item)).toBe(false);
    expect(canCheckPluginUpdateFromRemote(item)).toBe(false);
    expect(getPluginToggleDisabledReason(item, pluginStoreMessage)).toBe('核心能力不可禁用');
  });

  it('prevents missing plugins from using the enable switch', () => {
    const item = createPluginItem({
      id: 'mindmap',
      state: 'missing',
      reason: '插件目录不存在',
    });

    expect(canTogglePlugin(item)).toBe(false);
    expect(canUninstallPlugin(item)).toBe(false);
    expect(canInstallPluginFromRemote(item)).toBe(true);
    expect(canCheckPluginUpdateFromRemote(item)).toBe(false);
    expect(getPluginToggleDisabledReason(item, pluginStoreMessage)).toBe('插件目录不存在');
  });

  it('allows disabled optional plugins to be toggled and checked without install buttons', () => {
    const item = createPluginItem({ id: 'mindmap', state: 'disabled' });

    expect(canTogglePlugin(item)).toBe(true);
    expect(canUninstallPlugin(item)).toBe(true);
    expect(canInstallPluginFromRemote(item)).toBe(false);
    expect(canCheckPluginUpdateFromRemote(item)).toBe(true);
    expect(getPluginToggleDisabledReason(item, pluginStoreMessage)).toBeNull();
  });

  it('allows enabled optional plugins to check updates from the card', () => {
    const item = createPluginItem({ id: 'mindmap', state: 'enabled' });

    expect(canTogglePlugin(item)).toBe(true);
    expect(canUninstallPlugin(item)).toBe(true);
    expect(canInstallPluginFromRemote(item)).toBe(false);
    expect(canCheckPluginUpdateFromRemote(item)).toBe(true);
    expect(getPluginToggleDisabledReason(item, pluginStoreMessage)).toBeNull();
  });
});
