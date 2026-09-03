/**
 * @file knowledgeBaseService.d.ts
 * @description KnowledgeBaseService 的 TypeScript 类型声明（供 TS 文件消费）
 *
 * 中文说明（根因级）：\n
 * - `knowledgeBaseService.js` 是 JS 文件；在当前 TS 配置/IDE 组合下，TS 可能把其方法返回值推断为 `Object`，\n
 *   导致 TS 侧访问 `response.results` / `response.knowledge_bases` 报错。\n
 * - 这里使用“**按 import specifier 声明 module**”的方式，把类型牢牢绑定到\n
 *   `@/domains/knowledgebase/services/knowledgeBaseService` 这个路径上，保证 TS 稳定生效。\n
 */

declare module '@/domains/knowledgebase/services/knowledgeBaseService' {
  export interface KnowledgeBaseSummary {
    id: string;
    name: string;
    description?: string;
    documentCount?: number;
    embeddingModelId?: string | null;
  }

  export interface GetAllKnowledgeBasesResponse {
    knowledge_bases: KnowledgeBaseSummary[];
    total: number;
    timestamp: string;
  }

  export interface KnowledgeBaseSearchRequest {
    query: string;
    topK?: number;
    useReranking?: boolean;
    filter?: Record<string, unknown>;
    embeddingModelId?: string | null;
    rerankModelId?: string | null;
  }

  export interface KnowledgeBaseSearchResultItem {
    text: string;
    docId: string;
    docTitle: string;
    score: number;
    matchType?: string;
    blockType?: string;
    blockId?: string;
    page?: number;
  }

  export interface KnowledgeBaseSearchResponse {
    results: KnowledgeBaseSearchResultItem[];
    meta?: Record<string, unknown>;
    kbId?: string;
    kb_id?: string;
    timestamp?: string;
  }

  export interface ContinueFailedPdfPagesResponse {
    success: boolean;
    docId: string;
    attemptedPages: number[];
    recoveredPages: number[];
    remainingFailedPages: number[];
    addedBlocks: number;
    timestamp: string;
  }

  /**
   * 知识库文档记录（最小字段集合）
   *
   * 中文说明：
   * - knowledgeBaseService.js 的 getDocuments(kbId) 会返回 documents 数组；
   * - 这里不强绑定所有字段，只声明 GlobalModals 等 TS 代码用到的最小字段（如 id）。
   */
  export interface KnowledgeBaseDocumentItem {
    id: string;
    [key: string]: unknown;
  }

  /**
   * 获取知识库文档列表的响应（与 knowledgeBaseService.js 返回结构对齐）
   */
  export interface GetKnowledgeBaseDocumentsResponse {
    documents: KnowledgeBaseDocumentItem[];
    total: number;
    kb_id: string;
    timestamp: string;
  }

  export interface KnowledgeBaseService {
    getAllKnowledgeBases(): Promise<GetAllKnowledgeBasesResponse>;
    getDocuments(kbId: string): Promise<GetKnowledgeBaseDocumentsResponse>;
    continueFailedPdfPages(
      kbId: string,
      docId: string,
      modelConfig?: {
        pdfOcrModelId?: string | null;
        embeddingModelId?: string | null;
      }
    ): Promise<ContinueFailedPdfPagesResponse>;
    searchInKnowledgeBase(
      kbId: string,
      request: KnowledgeBaseSearchRequest
    ): Promise<KnowledgeBaseSearchResponse>;
    getCitationSnapshotBundle(
      bundleId: string,
      conversationId: string,
      instanceId?: string,
    ): Promise<unknown>;
  }

  export const knowledgeBaseService: KnowledgeBaseService;
}

export {};
