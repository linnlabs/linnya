import type { ConversationContextUsage } from '@app/schemas';

export type ContextWindowUsageLevel = 'normal' | 'elevated' | 'critical';
export type ContextWindowUsageSegmentId = 'system_prompt' | 'conversation' | 'tool_definitions';

export interface ContextWindowUsageSegment {
  readonly id: ContextWindowUsageSegmentId;
  readonly tokens: number;
  readonly share: number;
}

export type ContextWindowUsagePresentation =
  | {
    readonly status: 'hidden' | 'loading' | 'unavailable';
  }
  | {
    readonly status: 'current' | 'overflow';
    readonly usage: ConversationContextUsage;
    readonly contextWindowTokens: number;
    readonly level: ContextWindowUsageLevel;
    readonly ratio: number;
    readonly drawPercent: number;
    readonly segments: readonly ContextWindowUsageSegment[];
  };

