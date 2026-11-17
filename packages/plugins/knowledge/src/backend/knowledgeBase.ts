/**
 * @file src/knowledge-base/index.ts
 *
 * @brief 知识库模块的主导出文件
 *
 * @description
 * 这个文件负责导出知识库模块的所有公共接口、类型和服务。
 * 使用分层架构导出模式，方便其他模块引用知识库功能。
 */

// Domain层导出
export * from './domain/document';
export * from './domain/knowledgeBase';
export * from './domain/block';

// Infrastructure层导出
export type { QdrantRepository, PointPayload } from './infrastructure/qdrantRepository';
export type { SotRepository } from './infrastructure/sotRepository';
export type { MetadataRepository } from './infrastructure/metadataRepository';

// Application层导出
export type { KnowledgeBaseService } from './application/knowledgeBaseService';
export type { SearchService } from './application/searchService';
export { DefaultSearchService } from './application/searchService';
export { KnowledgeBaseCoordinator } from './application/KnowledgeBaseCoordinator'; 