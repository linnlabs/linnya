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
  /** 用户在卡上换了一套配色后提交。 */
  readonly paletteChanged?: true;
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

/** 视觉方向只在 Agent 侧使用；卡片只说明这一步在做什么，不展示方向来源。 */
export interface SlidesDirectionPresentationData {
  readonly kind: 'direction';
}

export interface SlidesExportPresentationData {
  readonly kind: 'export';
  readonly presentationId: string | null;
  readonly fileName: string | null;
  readonly sizeBytes: number | null;
}
