import type { AiMessage, ContextCompactionPlan } from '../../../../contracts';

export type ContextCompactionRebuildValidationResult =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason: 'replacement_survived' | 'orphan_tool_output';
      readonly messageId: string;
    };

export interface ValidateContextCompactionRebuildInput {
  readonly messages: readonly AiMessage[];
  readonly pendingSummaryId: string;
  readonly plan: ContextCompactionPlan;
}
