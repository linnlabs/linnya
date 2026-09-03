/**
 * @file workspace-schema.provider.ts
 * @description WorkspaceSchemaProvider 聚合器。
 * 
 * 此类不包含任何 SQL 语句。它的职责是从 schemas/ 目录中
 * 导入并组合所有工作区相关的表结构定义。
 */

import { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { CORE_SCHEMAS } from './schemas/core.schema';
import { AGENTS_SCHEMAS } from './schemas/agents.schema';
import { TODO_SCHEMAS } from '../../../project-todo/infrastructure/sqlite/todo.schema';
import { WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS } from './schemas/search-index.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from './schemas/node-text-snapshot.schema';

export class WorkspaceSchemaProvider implements ISchemaProvider {
  readonly name = 'workspace';

  getSchema(): string[] {
    return [
      // 1. 核心结构（项目和节点树）
      ...CORE_SCHEMAS,

      // 2. 通用 Agent 配置表
      ...AGENTS_SCHEMAS,

      // 3. Todo 功能表
      ...TODO_SCHEMAS,

      // 4. Workspace Path Layer grep 搜索索引
      ...WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS,

      // 5. 插件事实文本快照（read/grep 降级读取）
      ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS,
    ];
  }
}
