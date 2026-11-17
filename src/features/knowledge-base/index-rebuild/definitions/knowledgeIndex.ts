/** 身份代表同一个向量空间；本地 modelId 只用于从 Host 目录发起调用。 */
export interface KnowledgeIndexIdentity {
  readonly modelId: string;
  readonly spaceId: string;
}

export interface KnowledgeIndexState {
  readonly modelId: string | null;
  readonly spaceId: string | null;
}

export class KnowledgeIndexRebuildRequiredError extends Error {
  readonly code = 'knowledge_index_rebuild_required';
  constructor(readonly kbId: string) {
    super('检索索引需要重建。请在知识库的文件管理中选择“重建检索索引”；原文仍可正常阅读。');
    this.name = 'KnowledgeIndexRebuildRequiredError';
  }
}

export class KnowledgeIndexSpaceMismatchError extends Error {
  readonly code = 'knowledge_index_space_mismatch';
  constructor(readonly kbId: string) {
    super('当前嵌入模型的向量空间与已有索引不同。请先重建检索索引，原文不会被删除。');
    this.name = 'KnowledgeIndexSpaceMismatchError';
  }
}
