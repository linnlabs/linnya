/**
 * @file knowledge-base-schema.provider.ts
 * @description 知识库 Schema Provider - 为 DatabaseService 提供知识库表结构
 * 
 * 职责：
 * - 聚合知识库相关的所有表定义
 * - 注册到 DatabaseService，在初始化时统一创建表
 */

import { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { KNOWLEDGE_BASE_SCHEMAS } from './knowledge-base.schema';

/**
 * 知识库 Schema Provider
 * 
 * 功能 (What): 提供知识库元数据表的 DDL 定义
 * 输入 (Input): 无
 * 输出 (Output): 表结构的 SQL 语句数组
 * 副作用 (Side-effects): 无
 */
export class KnowledgeBaseSchemaProvider implements ISchemaProvider {
  readonly name = 'KnowledgeBase';

  getSchema(): string[] {
    return KNOWLEDGE_BASE_SCHEMAS;
  }
}

