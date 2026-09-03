import type { Alias, AliasOptions } from 'vite';
import { defineConfig } from 'vitest/config';

import hostVitestConfig from '../../vitest.config';

export interface PluginVitestConfigOptions {
  readonly packageDirectory: string;
  readonly packageAliases: readonly Alias[];
}

/**
 * 为仓内插件建立自有 Vitest 配置组合根。
 * 文件名遵守测试基础设施门禁，只能由 Vitest 配置消费。
 *
 * 插件 package alias 必须排在 Host 的 `@plugin/*` facade alias 之前，否则
 * `@plugin/<plugin-id>/...` 会被错误解析成 Host SDK 内部路径。Host 提供通用测试
 * 运行时，具体插件路径则始终由插件 owner 自己声明。
 */
export function createPluginVitestConfig(
  options: PluginVitestConfigOptions,
) {
  return defineConfig({
    ...hostVitestConfig,
    root: options.packageDirectory,
    resolve: {
      ...hostVitestConfig.resolve,
      alias: [
        ...options.packageAliases,
        ...normalizeAliases(hostVitestConfig.resolve?.alias),
      ],
    },
  });
}

function normalizeAliases(aliases: AliasOptions | undefined): Alias[] {
  if (aliases === undefined) return [];
  if (Array.isArray(aliases)) return [...aliases];
  return Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }));
}
