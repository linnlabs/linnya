/**
 * @file src/features/knowledge-base/ingestion/ingestionTypes.ts
 *
 * 目的：
 * - 让摄入链路（Parsing → Embedding → Storing）的产物在编译期可被约束
 * - 避免 `any` 在 TaskContext 中继续扩散
 *
 * 设计原则：
 * - 最小结构：只保留链路真正会用到的字段
 * - 向后兼容：允许存在额外字段（通过 Record<string, unknown> 承接），但核心字段强制存在
 */

import type { DocumentSoT, SourceInfo } from '../domain/block';
import type { BlockType } from '../domain/block';
import type { DocumentParseDiagnostics } from '../domain/document';
import type { SparseVector } from '../infrastructure/qdrantRepository';

/**
 * 解析后（后处理后）的内容块：用于向量化与写入 SoT/Qdrant
 *
 * 说明：
 * - `id` 是 block_id（必须稳定且唯一）
 * - `block_type/level/source_info` 与 SoT 的 BlockSchema 对齐
 */
export interface ParsedContentBlock {
  id: string;
  block_type: BlockType;
  text: string;
  level: number | null;
  source_info: SourceInfo;
  /**
   * 可选：当块由拆分产生时，记录其父块信息，便于聚合与调试
   */
  parent_block_id?: string;
  part_index?: number;
}

/**
 * Parsing 阶段产物
 */
export interface ParseResult {
  contentBlocks: ParsedContentBlock[];
  /**
   * 以 SoT 结构为准的文档内容真相
   */
  sourceDoc: DocumentSoT;
  metadata: {
    fileType: string;
    totalBlocks: number;
    parser: string;
    postProcessed: true;
    parseDiagnostics?: DocumentParseDiagnostics;
  };
}

/**
 * Embedding 阶段产物：在 ParsedContentBlock 基础上补齐向量
 */
export interface VectorizedBlock extends ParsedContentBlock {
  vector: number[];
  sparse_vector: SparseVector;
  vectorModel: string;
  sparseVectorModel: 'bm25';
  vectorTimestamp: number;
}

export interface VectorizeResult {
  vectorizedBlocks: VectorizedBlock[];
  metadata: Record<string, unknown>;
}

export interface StoreResult {
  vectorCount: number;
  storageTimestamp: number;
  success: true;
}

