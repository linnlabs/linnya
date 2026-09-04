import {
  type PresentationInspectionFeedbackOptions,
  type PresentationInspectionRequest,
  type PresentationInspectionSnapshot,
  type PresentationRenderModel,
  type SourceLocationHint,
} from '@plugin/slides/shared';
import { collectEditableTargetsBySlide } from '@plugin/slides/shared/renderModel/editableTargets';
import type {
  DiagnosticToolFeedbackPayload,
  PresentationInspectionResult,
} from '../definitions/presentationInspection';
import { resolvePresentationInspectionSelection } from '../functions/resolvePresentationInspectionSelection';
import { countSourceSpanUses } from '../functions/countSourceSpanUses';

export interface PresentationInspectionRuntimeDeps {
  readonly loadSnapshot: (
    presentationId: string,
  ) => Promise<PresentationInspectionSnapshot>;
  readonly loadSourceLocations: (
    renderModel: PresentationRenderModel,
  ) => Promise<ReadonlyMap<number, SourceLocationHint> | undefined>;
  readonly buildFeedback: (
    presentationId: string,
    versionId: string,
    renderModel: PresentationRenderModel,
    editableTargetsBySlide: ReturnType<typeof collectEditableTargetsBySlide>,
    options: PresentationInspectionFeedbackOptions,
  ) => Promise<DiagnosticToolFeedbackPayload>;
}

/**
 * Slides 结构检查的共享只读编排。
 *
 * 工具与 CLI 必须从同一次版本快照派生页选择与 finding，避免一个入口
 * 使用数字版次、另一个入口使用真实 version id，或分别重写 quality 规则。
 */
export class PresentationInspectionRuntime {
  constructor(private readonly deps: PresentationInspectionRuntimeDeps) {}

  async inspect(
    request: PresentationInspectionRequest,
  ): Promise<PresentationInspectionResult> {
    if (!request.presentationId.trim()) {
      throw new Error('Presentation inspection requires a presentation id');
    }

    const snapshot = await this.deps.loadSnapshot(request.presentationId);
    const sourceSpanUseCounts = countSourceSpanUses(snapshot.renderModel);
    const selected = resolvePresentationInspectionSelection(
      snapshot.renderModel,
      request.selection,
      request.maxSlides,
    );
    const sourceLocations = await this.deps.loadSourceLocations(selected.renderModel);
    const feedback = await this.deps.buildFeedback(
      request.presentationId,
      snapshot.versionId,
      selected.renderModel,
      collectEditableTargetsBySlide(selected.renderModel),
      {
        includeHeuristics: request.includeHeuristics,
        sourceSpanUseCounts,
        ...(sourceLocations ? { sourceLocations } : {}),
      },
    );

    return {
      versionId: snapshot.versionId,
      renderModel: selected.renderModel,
      totalSlideCount: snapshot.renderModel.slides.length,
      requestedSlideNumbers: selected.requestedSlideNumbers,
      truncated: selected.truncated,
      feedback,
    };
  }
}
