import os from 'node:os';
import type { Alias, AliasOptions } from 'vite';
import { defineConfig } from 'vitest/config';

import hostVitestConfig from '../../vitest.config';

export const DEFAULT_PLUGIN_VITEST_MAX_WORKERS = 12;

export function resolvePluginVitestMaxWorkers(
  rawValue = process.env.LINNYA_PLUGIN_VITEST_MAX_WORKERS,
  availableCores = os.availableParallelism(),
): number {
  const cappedDefault = Math.max(1, Math.min(availableCores, DEFAULT_PLUGIN_VITEST_MAX_WORKERS));
  if (rawValue === undefined) return cappedDefault;
  const trimmed = rawValue.trim();
  if (trimmed === '') return cappedDefault;
  if (!/^[1-9]\d*$/u.test(trimmed)) {
    throw new Error(
      `LINNYA_PLUGIN_VITEST_MAX_WORKERS must be a positive integer, got: ${JSON.stringify(rawValue)}`,
    );
  }
  return Number(trimmed);
}

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
    test: {
      ...hostVitestConfig.test,
      maxWorkers: resolvePluginVitestMaxWorkers(),
    },
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
