/**
 * @file src/plugin-sdk/api.ts
 * 
 * @brief 定义插件注册API
 *
 * @description
 * 提供插件注册的统一接口，包括节点注册、Agent工具注册、命令注册等功能。
 */

import { Tool } from './types';

/**
 * 插件节点定义接口
 */
export interface PluginNodeDefinition {
  name: string;
  displayName: string;
  description?: string;
  component: unknown;
  config?: Record<string, unknown>;
}

/**
 * 插件命令定义接口
 */
export interface PluginCommandDefinition {
  id: string;
  name: string;
  description?: string;
  shortcut?: string;
  execute: (context?: unknown) => void | Promise<void>;
}

/**
 * 插件Agent工具定义接口
 */
export interface PluginAgentToolDefinition {
  tool: Tool;
  config?: Record<string, unknown>;
}

function throwDeprecatedRegistrationApi(functionName: string): never {
  throw new Error(
    `[plugin-sdk/api] ${functionName} 是历史空实现，已废弃。请通过 backend/renderer contribution 或 @plugin/* port 注册插件能力。`,
  );
}

/**
 * 注册插件节点
 */
export function registerNode(definition: PluginNodeDefinition): void {
  void definition;
  throwDeprecatedRegistrationApi('registerNode');
}

/**
 * 注册插件命令
 */
export function registerCommand(definition: PluginCommandDefinition): void {
  void definition;
  throwDeprecatedRegistrationApi('registerCommand');
}

/**
 * 注册Agent工具
 */
export function registerAgent(definition: PluginAgentToolDefinition): void {
  void definition;
  throwDeprecatedRegistrationApi('registerAgent');
}
