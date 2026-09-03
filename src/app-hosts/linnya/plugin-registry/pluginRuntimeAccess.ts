import type { PluginId } from '@app/schemas';
import { getPluginRuntimeState, isPluginRuntimeEnabled } from './pluginRuntimeState';

export function buildPluginRuntimeDisabledMessage(params: {
  readonly pluginId: PluginId;
  readonly pluginName: string;
  readonly action: string;
  readonly includeExistingDataNote?: boolean;
}): string {
  const state = getPluginRuntimeState(params.pluginId);
  const existingDataNote = params.includeExistingDataNote === false
    ? ''
    : '；已有数据会保留';
  if (state === 'missing') {
    return `${params.pluginName} 插件未安装，不能${params.action}。请安装并启用 ${params.pluginName} 插件后重试${existingDataNote}。`;
  }
  return `${params.pluginName} 插件未启用，不能${params.action}。请启用 ${params.pluginName} 插件后重试${existingDataNote}。`;
}

export function assertPluginRuntimeEnabled(params: {
  readonly pluginId: PluginId;
  readonly pluginName: string;
  readonly action: string;
  readonly includeExistingDataNote?: boolean;
}): void {
  if (!isPluginRuntimeEnabled(params.pluginId)) {
    throw new Error(buildPluginRuntimeDisabledMessage(params));
  }
}
