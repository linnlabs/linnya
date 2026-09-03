import type { PptPlanData } from '@plugin/slides/shared/pptPlanToolContract';

export interface PresentationPageSummary {
  readonly slideNumber: number;
  readonly layoutKey?: string;
  readonly elementCount?: number;
  readonly editableTargetCount?: number;
}

export interface SlidesPlanInteractionPresentation {
  readonly status: 'active' | 'approved' | 'modified';
  readonly submittedAt?: number;
  readonly notes?: string;
  readonly modifiedPlan?: PptPlanData;
}

export interface SlidesPlanPresentationData {
  readonly kind: 'plan';
  readonly toolCallId: string;
  readonly plan: PptPlanData | null;
  readonly interaction: SlidesPlanInteractionPresentation;
}

export interface SlidesInspectPresentationData {
  readonly kind: 'inspect';
  readonly presentationId: string | null;
  readonly title: string | null;
  readonly slideCount: number | null;
  readonly pages: readonly PresentationPageSummary[];
}

export interface SlidesExportPresentationData {
  readonly kind: 'export';
  readonly presentationId: string | null;
  readonly fileName: string | null;
  readonly sizeBytes: number | null;
}
