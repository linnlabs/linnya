export type KnowledgeActivityKind = 'search' | 'ingestion' | 'graph' | 'delete' | 'rebuild' | 'maintenance';

export interface KnowledgeActivityLease {
  readonly signal: AbortSignal;
  release(): void;
}

export class KnowledgeActivityBusyError extends Error {
  readonly code = 'knowledge_activity_busy';
  constructor(readonly kbId: string) {
    super('知识库仍有正在执行的任务。请等待完成或取消后再操作。');
    this.name = 'KnowledgeActivityBusyError';
  }
}
