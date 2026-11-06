import type { DocumentHistoryFailureCode, DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import type { PluginToolContext } from './toolRuntime';

/** 列表必须是同一个数据库快照；版本载荷不跨越此边界。 */
export interface DocumentHistoryCapability {
  list(input: { readonly documentId: string; readonly context: PluginToolContext }): readonly DocumentVersionSummary[] | Promise<readonly DocumentVersionSummary[]>;
  restore(input: DocumentVersionRestoreRequest & { readonly context: PluginToolContext }): Promise<DocumentVersionSummary>;
}

export declare class DocumentHistoryError extends Error {
  readonly code: DocumentHistoryFailureCode;
  readonly cause?: unknown;
  constructor(code: DocumentHistoryFailureCode, options?: { readonly cause: unknown });
}

/** 只返回身份集合；SQL、差分重建与内部必保依赖由文档类型拥有。 */
export interface DocumentVersionRetentionBudget {
  readonly budgetBytes: number;
  /** 调用方算好包含历史资产的实际占用；共享字节只在其归属的一个版本计入。 */
  readonly versionBytes: readonly { readonly versionId: string; readonly byteLength: number }[];
}

export declare function planDocumentVersionRetention(rows: readonly DocumentVersionSummary[], budget?: DocumentVersionRetentionBudget): {
  readonly keepVersionIds: readonly string[];
  readonly removeVersionIds: readonly string[];
  readonly overBudgetBytes?: number;
};
