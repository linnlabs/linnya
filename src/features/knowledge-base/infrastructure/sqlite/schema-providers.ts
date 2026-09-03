/**
 * @file src/features/knowledge-base/infrastructure/sqlite/schema-providers.ts
 *
 * @description
 * KnowledgeBase Feature 对外暴露的 schema providers 聚合入口。
 */

import type { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { KnowledgeBaseSchemaProvider } from './knowledge-base-schema.provider';
import { KnowledgeGraphSchemaProvider } from '../../graph/infrastructure/sqlite/knowledge-graph-schema.provider';

export function getKnowledgeBaseSchemaProviders(): ISchemaProvider[] {
  // ⚠️ 顺序很重要：KnowledgeGraph 的表依赖 knowledge_bases（FK），必须确保 KB schema 先执行
  return [new KnowledgeBaseSchemaProvider(), new KnowledgeGraphSchemaProvider()];
}


