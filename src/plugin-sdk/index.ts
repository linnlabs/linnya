/**
 * @file src/plugin-sdk/index.ts
 *
 * @brief 插件SDK主入口文件
 *
 * @description
 * 统一导出插件开发所需的所有接口、类型和API函数
 */

// 导出类型定义
export * from './types';

// 导出API函数
export * from './api';

// 重新导出常用的类型
export type {
  PluginNodeDefinition,
  PluginCommandDefinition,
  PluginAgentToolDefinition
} from './api';

// 重新导出工具基类
export { Tool } from './types'; 