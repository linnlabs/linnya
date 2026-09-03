/**
 * @file src/tools/knowledgebase/search/types.ts
 * @description 知识库搜索工具的类型定义
 *
 * 本文件定义了知识库搜索工具返回的结构化数据类型，
 * 包括 UI 展示所需的文档列表和 RAG 引用所需的元数据。
 */

import type {
  KnowledgeGraphDigest,
  KnowledgeSearchCitation,
  KnowledgeSearchCitationMetadata,
} from '@app/schemas';

/** 工具内部用于组装 observation、citation 与图谱摘要的稳定证据事实。 */
export interface KnowledgeSearchDocument {
  /** 文档 ID */
  doc_id: string;

  /** 文档名称 */
  doc_name: string;

  /** 页码 */
  page?: number;

  /** 块 ID */
  block_id: string;

  /** 经过 admission 的证据片段 */
  snippet: string;
}

export interface AdmittedKnowledgeSearchDocument extends KnowledgeSearchDocument {
  /** 搜索应用层已通过 Conversation allocator 接纳的短引用。 */
  readonly ref: string;
}
export type { KnowledgeGraphDigest } from '@app/schemas';

// ============ 工具函数 ============

/**
 * 从搜索证据事实构建引用元数据
 *
 * @param documents 搜索证据列表
 * @param query 搜索查询词
 * @param searchMode 搜索模式
 * @param docName 文档名称(单文档搜索时)
 * @param citationOffset 🔥 引用编号偏移量,用于多次工具调用时保持编号连续
 * @returns 引用元数据
 */
export function buildCitationMetadataFromResults(
  documents: AdmittedKnowledgeSearchDocument[],
  query: string,
  searchMode: 'global' | 'document',
  docName?: string,
  citationOffset: number = 0
): KnowledgeSearchCitationMetadata {
  const citations: KnowledgeSearchCitation[] = documents.map((doc, index) => {
    const docId = doc.doc_id;
    const blockId = doc.block_id;
    return {
      ref: doc.ref,
      index: citationOffset + index + 1, // 🔥 应用偏移量
      sourceType: 'knowledge_base',
      docId,
      blockId,
      docTitle: doc.doc_name,
      snippet: doc.snippet,
      pageNumber: doc.page,
    };
  });

  return {
    query,
    searchMode,
    citations,
    docName: docName ?? undefined,
  };
}
