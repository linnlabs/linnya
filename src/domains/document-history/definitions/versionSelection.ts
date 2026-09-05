import type { DocumentVersionSummary } from '@app/schemas';

export interface DocumentHistorySelection {
  readonly recent: readonly DocumentVersionSummary[];
  readonly earlier: readonly DocumentVersionSummary[];
}

export interface DocumentVersionRetentionPlan {
  readonly keepVersionIds: readonly string[];
  readonly removeVersionIds: readonly string[];
}
