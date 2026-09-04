import type { EditableTarget, PresentationRenderModel } from '@plugin/slides/shared';
import { buildSlideTools } from '@plugin/slides/shared/toolCapabilities';
import { buildSceneGraph, buildSpatialAnalysis, countRenderableNodes } from './sceneGraph.js';
import {
  collectFindings,
  evaluateQualityAnalysis,
} from './diagnostics.js';
import { HeuristicLint } from '../../engine/quality/HeuristicLint.js';
import { renderModelToLintInfo } from '../../engine/quality/renderModelToLintInfo.js';
import type { SlidesEngineExecutionAdapter } from '../../engine/types.js';
import type {
  InspectBackgroundSummary,
  InspectPageSummary,
  SourceLocationHint,
} from '@plugin/slides/shared';
import type { DiagnosticToolFeedbackPayload } from '../../features/presentationInspection';
import type { SlideBackgroundModel } from '@plugin/slides/shared';

export interface BuildToolFeedbackPayloadOptions {
  /**
   * P1-B.2 Tier-2：是否合并 HeuristicLint（启发式 info 提示）到 aesthetic 报告。
   * 默认 false。仅在调用方显式开启（例如 `ppt_inspect({ heuristics: true })`）才生效。
   *
   * 启用时，启发式 issue 会被合并进质量分析结果，自动复用
   * P1-C 第 1 批接通的 diagnostics → suggestion → observation 管道，
   * 因此启发式结果进入同一 `findings` 契约，但不会改变构建状态。
   */
  includeHeuristics?: boolean;
  sourceLocations?: ReadonlyMap<number, SourceLocationHint>;
  sourceSpanUseCounts?: ReadonlyMap<string, number>;
  spatialAnalyzer: Pick<SlidesEngineExecutionAdapter, 'analyzeSpatial'>;
}

export async function buildToolFeedbackPayload(
  presentationId: string,
  versionId: string,
  renderModel: PresentationRenderModel,
  editableTargetsBySlide: Map<number, EditableTarget[]>,
  options: BuildToolFeedbackPayloadOptions,
  changedSlides?: number[],
): Promise<DiagnosticToolFeedbackPayload> {
  const qualityAnalysis = evaluateQualityAnalysis(renderModel);

  if (options.includeHeuristics) {
    const lintInfo = renderModelToLintInfo(renderModel);
    const heuristicReport = new HeuristicLint().lint(lintInfo);
    if (heuristicReport.issues.length > 0) {
      /* 直接拼接进 aesthetic 数组，后续作为低置信度 info finding 输出。
       * 启发式结果不改变 buildStatus；成功取得 RenderModel 即为 ready。 */
      qualityAnalysis.aesthetic.push(...heuristicReport.issues);
    }
  }

  const sceneGraph = buildSceneGraph(renderModel);
  const spatialAnalysis = await buildSpatialAnalysis(sceneGraph, options.spatialAnalyzer);
  const findings = collectFindings(qualityAnalysis, sceneGraph, spatialAnalysis, changedSlides, {
    sourceLocations: options.sourceLocations,
    sourceSpanUseCounts: options.sourceSpanUseCounts ?? new Map(),
  });

  return {
    artifact: {
      presentationId,
      versionId,
      slideCount: renderModel.slides.length,
    },
    pageSummaries: buildInspectPageSummaries(renderModel, editableTargetsBySlide, options.sourceLocations),
    sceneGraph,
    spatialAnalysis,
    buildStatus: { state: 'ready' },
    findings,
  };
}

export async function buildToolFeedbackPayloadAsync(
  presentationId: string,
  versionId: string,
  renderModel: PresentationRenderModel,
  editableTargetsBySlide: Map<number, EditableTarget[]>,
  options: BuildToolFeedbackPayloadOptions,
  changedSlides?: number[],
): Promise<DiagnosticToolFeedbackPayload> {
  return buildToolFeedbackPayload(
    presentationId,
    versionId,
    renderModel,
    editableTargetsBySlide,
    options,
    changedSlides,
  );
}

export function buildInspectPageSummaries(
  model: PresentationRenderModel,
  editableTargetsBySlide: Map<number, EditableTarget[]>,
  sourceLocations?: ReadonlyMap<number, SourceLocationHint>,
): InspectPageSummary[] {
  return model.slides.map((slide) => ({
    slideNumber: slide.index + 1,
    layoutKey: slide.layoutKey,
    elementCount: countRenderableNodes(slide.elements),
    background: summarizeSlideBackground(slide.background),
    editableTargets: editableTargetsBySlide.get(slide.index + 1) ?? [],
    slideTools: buildSlideTools(model.sourceKind),
    ...(sourceLocations?.get(slide.index + 1) ? { sourceLocation: sourceLocations.get(slide.index + 1) } : {}),
  }));
}

function summarizeSlideBackground(background: SlideBackgroundModel): InspectBackgroundSummary {
  const paint = background.paint;
  return {
    color: paint.type === 'solid' ? paint.color : undefined,
    imageSrc: background.imageSrc,
    gradient: paint.type === 'linear' || paint.type === 'radial' ? paint : undefined,
  };
}
