/**
 * @file registry.ts
 * @description Tool UI Registry 总装文件
 *
 * 职责：
 * - 从 renderer plugin registry 汇聚工具卡贡献
 * - 导出唯一的 TOOL_UI_REGISTRY 供前端消费
 *
 * 新增工具卡片时，应由对应插件贡献 toolCards，避免 UI 卡片和工具启停状态分叉。
 */

import type { ToolUiConfig, ToolUiEntry } from './types';
import { isAliasConfig } from './types';
import { listToolCards } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';

export interface ResolvedToolUiConfig {
  readonly uiKey: string;
  readonly config: ToolUiConfig;
}

export function getToolUiRegistry(): Readonly<Record<string, ToolUiEntry>> {
  const enabledPluginsStore = useEnabledPluginsStore();
  return listToolCards(enabledPluginsStore.enabledPluginIds);
}

/**
 * 解析工具的最终 UI 配置
 *
 * - 普通条目（ToolUiConfig）：直接返回
 * - 别名条目（ToolUiAliasConfig）：根据 args/result 动态解析到已注册的渲染配置
 * - 别名不允许嵌套：如果解析到的 key 仍然是别名，返回 null
 */
export function resolveToolUiConfig(
  toolName: string,
  args: unknown,
  result?: unknown,
): ToolUiConfig | null {
  return resolveToolUiConfigWithKey(toolName, args, result)?.config ?? null;
}

/** presentation 已固定最终 uiKey 后只允许直接读取，禁止再次执行 alias resolver。 */
export function readToolUiConfigByKey(uiKey: string): ToolUiConfig | null {
  const entry = getToolUiRegistry()[uiKey];
  return !entry || isAliasConfig(entry) ? null : entry;
}

/** alias 只在 registry owner 内解析一次，并把最终 key 与配置一并交给 admission。 */
export function resolveToolUiConfigWithKey(
  toolName: string,
  args: unknown,
  result?: unknown,
): ResolvedToolUiConfig | null {
  const registry = getToolUiRegistry();
  const entry = registry[toolName];
  if (!entry) return null;

  if (!isAliasConfig(entry)) return { uiKey: toolName, config: entry };

  const resolvedKey = entry.resolveUiKey(args, result);
  if (!resolvedKey) return null;

  const resolved = registry[resolvedKey];
  if (!resolved || isAliasConfig(resolved)) return null;

  return { uiKey: resolvedKey, config: resolved };
}
