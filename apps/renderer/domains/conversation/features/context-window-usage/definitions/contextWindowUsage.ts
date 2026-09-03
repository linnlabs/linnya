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
    readonly status: 'unavailable' | 'tail_unavailable';
  }
  | {
    readonly status: 'current' | 'historical_model' | 'overflow';
    readonly usage: ConversationContextUsage;
    readonly contextWindowTokens: number;
    readonly level: ContextWindowUsageLevel;
    readonly ratio: number;
    readonly drawPercent: number;
    readonly isHistoricalModel: boolean;
    readonly segments: readonly ContextWindowUsageSegment[];
  };

export interface ContextUsagePanelPositionInput {
  readonly trigger: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly panel: {
    readonly width: number;
    readonly height: number;
  };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly gap: number;
  readonly padding: number;
}

export interface ContextUsagePanelPosition {
  readonly top: number;
  readonly left: number;
}
