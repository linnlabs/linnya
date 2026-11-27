/** 身份代表同一个向量空间；本地 modelId 只用于从 Host 目录发起调用。 */
export interface KnowledgeIndexIdentity {
  readonly modelId: string;
  readonly spaceId: string;
}

export interface KnowledgeIndexState {
  readonly modelId: string | null;
  readonly spaceId: string | null;
}

/**
 * message 是中文说明（CLI、摄入失败记录用）；界面经 IPC 按 code 取本地化键，
 * Agent 工具用 toolMessage 的英文说明，三处给的恢复办法必须一致。
 */
export class KnowledgeIndexRebuildRequiredError extends Error {
  readonly code = 'knowledge_index_rebuild_required';
  readonly toolMessage =
    'Knowledge search failed: the search index of this knowledge base must be rebuilt. Retrying will not help. Tell the user to choose "Rebuild search index" in the knowledge base file manager; the original files can still be read.';
  constructor(readonly kbId: string) {
    super('检索索引需要重建。请在知识库的文件管理中选择“重建检索索引”；原文仍可正常阅读。');
    this.name = 'KnowledgeIndexRebuildRequiredError';
  }
}

export class KnowledgeIndexSpaceMismatchError extends Error {
  readonly code = 'knowledge_index_space_mismatch';
  readonly toolMessage =
    'Knowledge search failed: the current embedding model produces vectors in a different space from the existing search index. Retrying will not help. Tell the user to rebuild the search index in the knowledge base file manager; the original files are kept.';
  constructor(readonly kbId: string) {
    super('当前嵌入模型的向量空间与已有索引不同。请先重建检索索引，原文不会被删除。');
    this.name = 'KnowledgeIndexSpaceMismatchError';
  }
}

/** 元数据与 Worker 共用同一 SQLite 原子认领；不向调用者暴露连接。 */
export interface KnowledgeIndexStatePort {
  read(kbId: string): KnowledgeIndexState;
  requireReady(kbId: string): KnowledgeIndexIdentity;
  claimForAppend(kbId: string, identity: KnowledgeIndexIdentity, emptyIndexVerified: boolean): void;
  invalidateForRebuild(kbId: string): void;
  publishRebuilt(kbId: string, identity: KnowledgeIndexIdentity): void;
}

export type { KnowledgeIndexJobStatus } from '@app/schemas';
