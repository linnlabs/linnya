/**
 * plugin_cli 工具卡：外部 linnya 命令行运行已启用插件自己的命令（与 Linnya Shell 里的 linnya-<插件> 同一合同）。
 * 插件可以任意，卡片只按工具合同显示命令行与输出，不解释某个插件的报告字段。
 */

import { defineAsyncComponent } from 'vue';
import { TerminalIcon } from '@linnya/renderer-ui/icons';
import type { ToolUiConfig } from '../types';
import {
  projectPluginCliCompactStep,
  projectPluginCliPresentation,
} from '../pluginCli/functions/projectPluginCliPresentation';

const PluginCliCard = defineAsyncComponent(() => import('../pluginCli/PluginCliCard.vue'));

export const pluginCliToolConfigs: Record<string, ToolUiConfig> = {
  plugin_cli: {
    component: PluginCliCard,
    activity: 'command',
    icon: TerminalIcon,
    presentation: projectPluginCliPresentation,
    compactStep: projectPluginCliCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },
};
