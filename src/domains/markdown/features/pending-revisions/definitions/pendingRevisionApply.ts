import type {
  MarkdownDocJson,
  MarkdownImportResult,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';
import type { PendingRevision } from '../persistence';

export type ApplyMode = 'accept' | 'reject';

export interface ApplyPendingError {
  readonly blockId: string;
  readonly reason: string;
}

export interface ApplyAllPendingResult {
  readonly status: 'ok' | 'failed';
  readonly documentId: string;
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  /** 应用后的最新 docJson；失败时返回当前最新文档用于诊断。 */
  readonly docJson: MarkdownDocJson;
  readonly errors?: ApplyPendingError[];
}

export interface ApplySinglePendingResult {
  readonly status: 'ok' | 'failed';
  readonly documentId: string;
  readonly blockId: string;
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly errors?: ApplyPendingError[];
}

export type MarkdownImporter = (markdown: string) => Promise<MarkdownImportResult>;

export type MarkdownRootBlockJson = ProseMirrorJsonNode & {
  readonly type: 'rootBlock';
  readonly attrs: Record<string, unknown>;
};

export interface PreparedPendingReplacement {
  readonly pendingId: string;
  readonly blockId: string;
  readonly rootBlock: MarkdownRootBlockJson;
}

export type PendingSnapshotItem = Pick<
  PendingRevision,
  'id' | 'target_block_id' | 'new_markdown' | 'source' | 'operation' | 'meta_json' | 'created_at' | 'updated_at'
>;

export interface PendingDocumentApplyResult {
  readonly changed: boolean;
  readonly docJson: MarkdownDocJson;
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly errors: ApplyPendingError[];
}
