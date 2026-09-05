import type { DocumentHistoryFailureCode, DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import type { PluginToolContext } from './toolRuntime';

/** 列表必须是同一个数据库快照；版本载荷不跨越此边界。 */
export interface DocumentHistoryCapability {
  list(input: { readonly documentId: string; readonly context: PluginToolContext }): readonly DocumentVersionSummary[] | Promise<readonly DocumentVersionSummary[]>;
  restore(input: DocumentVersionRestoreRequest & { readonly context: PluginToolContext }): Promise<DocumentVersionSummary>;
}

export declare class DocumentHistoryError extends Error {
  readonly code: DocumentHistoryFailureCode;
  constructor(code: DocumentHistoryFailureCode);
}

/** 只返回身份集合；SQL、差分重建与内部必保依赖由文档类型拥有。 */
export declare function planDocumentVersionRetention(rows: readonly DocumentVersionSummary[]): {
  readonly keepVersionIds: readonly string[];
  readonly removeVersionIds: readonly string[];
};
