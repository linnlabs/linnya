/**
 * @file src/features/workspace/infrastructure/sqlite/schema-providers.ts
 *
 * @description
 * Workspace Feature 对外暴露的 schema providers 聚合入口。
 *
 * 设计目标：
 * - DatabaseService 不再硬编码 “new XXXProvider()” 列表；
 * - 每个 Feature 自己声明要注册哪些表；
 * - Electron 主进程只负责调用这些聚合函数并执行 DDL。
 */

import type { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { WorkspaceSchemaProvider } from './workspace-schema.provider';

/**
 * 获取 Workspace Feature 需要注册到 workspace.sqlite 的所有 schema providers。
 */
export function getWorkspaceSchemaProviders(): ISchemaProvider[] {
  return [
    new WorkspaceSchemaProvider(),
  ];
}
