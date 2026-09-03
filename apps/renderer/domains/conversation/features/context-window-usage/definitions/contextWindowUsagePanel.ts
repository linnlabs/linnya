export type ContextWindowUsageTone = 'system' | 'conversation' | 'tools';

export interface ContextWindowUsagePanelSegment {
  readonly id: string;
  readonly share: number;
  readonly tone: ContextWindowUsageTone;
}

export interface ContextWindowUsagePanelRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: ContextWindowUsageTone;
}

export interface ContextWindowUsagePanelDetailRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface VisibleContextWindowUsageSegment extends ContextWindowUsagePanelSegment {
  readonly relativeShare: number;
}

export interface ContextWindowUsageTrackPresentation {
  readonly usedShare: number;
  readonly segments: readonly VisibleContextWindowUsageSegment[];
}
