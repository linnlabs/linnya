/**
 * @file knowledge-graph-schema.provider.ts
 * @description 软知识图谱 Schema Provider - 为 DatabaseService 提供图谱表结构
 *
 * 说明：
 * - 该 Provider 只负责返回 DDL 数组，不执行任何数据库操作；
 * - DatabaseService 会在初始化（新库 v0）时统一执行 DDL；
 * - 旧库升级则通过 migrations（v11->v12）创建对应表。
 */

import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { KNOWLEDGE_GRAPH_SCHEMAS } from './knowledge-graph.schema';

export class KnowledgeGraphSchemaProvider implements ISchemaProvider {
  readonly name = 'KnowledgeGraph';

  getSchema(): string[] {
    return KNOWLEDGE_GRAPH_SCHEMAS;
  }
}


