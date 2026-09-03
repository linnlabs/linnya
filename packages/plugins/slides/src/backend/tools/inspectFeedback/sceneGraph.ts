import type {
  PresentationRenderModel,
  RenderNode,
  SpatialAnalysisSummary,
  SpatialBox,
  SpatialNode,
} from '@plugin/slides/shared';
import {
  createSlidesEngineExecutionContext,
  type SlidesEngineExecutionAdapter,
} from '../../engine/types.js';
import {
  buildNodeToolCapabilities,
  buildSlideTools,
  summarizeSlideTextLayoutProvenance,
} from '@plugin/slides/shared';
import { visitRenderNodes } from '@plugin/slides/shared';
import type {
  ReferenceFrameInfo,
  SceneGraphNodeSummary,
  SceneGraphSlideSummary,
} from '@plugin/slides/shared';

const SAFE_MARGIN = 0.3;
const CONTENT_MARGIN_X = 0.5;
const CONTENT_MARGIN_TOP = 0.9;
const CONTENT_MARGIN_BOTTOM = 0.45;

export function buildSceneGraph(
  model: PresentationRenderModel,
): SceneGraphSlideSummary[] {
  return model.slides.map((slide) => {
    const rootNodeId = `slide:${slide.index + 1}`;
    return {
      slideNumber: slide.index + 1,
      textLayoutProvenance: summarizeSlideTextLayoutProvenance(slide),
      referenceFrames: buildReferenceFrames(model.slideSize.width, model.slideSize.height),
      rootNode: {
        nodeId: rootNodeId,
        slideNumber: slide.index + 1,
        kind: 'slide',
        box: {
          x: 0,
          y: 0,
          w: model.slideSize.width,
          h: model.slideSize.height,
          unit: 'in',
        },
        localBox: {
          x: 0,
          y: 0,
          w: model.slideSize.width,
          h: model.slideSize.height,
          unit: 'in',
        },
        zIndex: -1,
        sourceKind: model.sourceKind,
        children: slide.elements.map((node) =>
          buildSceneGraphNodeSummary(
            slide.index + 1,
            node,
            rootNodeId,
            { x: 0, y: 0, w: model.slideSize.width, h: model.slideSize.height },
            model.sourceKind,
          )),
        capabilities: { tools: buildSlideTools(model.sourceKind) },
        referenceFrame: 'slide',
        diagnostics: [],
      },
    };
  });
}

export async function buildSpatialAnalysis(
  sceneGraph: SceneGraphSlideSummary[],
  analyzer: Pick<SlidesEngineExecutionAdapter, 'analyzeSpatial'>,
): Promise<SpatialAnalysisSummary[]> {
  const result: SpatialAnalysisSummary[] = [];
  for (const slide of sceneGraph) {
    result.push(await analyzer.analyzeSpatial({
      slideNodes: flattenSpatialNodes(slide.rootNode),
      context: createSlidesEngineExecutionContext('analyzeSpatial'),
    }));
  }
  return result;
}

export function countRenderableNodes(nodes: RenderNode[]): number {
  let count = 0;
  visitRenderNodes(nodes, () => {
    count += 1;
  });
  return count;
}

export function walkSceneGraph(
  node: SceneGraphNodeSummary,
  visitor: (node: SceneGraphNodeSummary) => void,
): void {
  visitor(node);
  for (const child of node.children) {
    walkSceneGraph(child, visitor);
  }
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildReferenceFrames(
  slideWidth: number,
  slideHeight: number,
): ReferenceFrameInfo[] {
  const frames: ReferenceFrameInfo[] = [{
    id: 'slide',
    box: { x: 0, y: 0, w: slideWidth, h: slideHeight, unit: 'in' },
  }];
  appendPositiveFrame(frames, {
    id: 'safe_area',
    x: SAFE_MARGIN,
    y: SAFE_MARGIN,
    width: slideWidth - SAFE_MARGIN * 2,
    height: slideHeight - SAFE_MARGIN * 2,
  });
  appendPositiveFrame(frames, {
    id: 'content_area',
    x: CONTENT_MARGIN_X,
    y: CONTENT_MARGIN_TOP,
    width: slideWidth - CONTENT_MARGIN_X * 2,
    height: slideHeight - CONTENT_MARGIN_TOP - CONTENT_MARGIN_BOTTOM,
  });
  return frames;
}

function appendPositiveFrame(
  frames: ReferenceFrameInfo[],
  input: {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): void {
  const width = round3(input.width);
  const height = round3(input.height);
  // 固定英寸参考区在极端合法画布上可能放不下；省略比产生无效几何更诚实。
  if (width <= 0 || height <= 0) return;
  frames.push({
    id: input.id,
    box: { x: input.x, y: input.y, w: width, h: height, unit: 'in' },
  });
}

function buildSceneGraphNodeSummary(
  slideNumber: number,
  node: RenderNode,
  parentNodeId: string,
  parentBox: SpatialBox,
  sourceKind: PresentationRenderModel['sourceKind'],
): SceneGraphNodeSummary {
  const localBox = toLocalBox(node.box, parentBox);
  const groupChildren = node.kind === 'group'
    ? node.children.map((child) =>
        buildSceneGraphNodeSummary(
          slideNumber,
          child,
          node.id,
          { x: node.box.x, y: node.box.y, w: node.box.w, h: node.box.h },
          sourceKind,
        ))
    : [];

  return {
    nodeId: node.id,
    slideNumber,
    kind: node.kind,
    box: node.box,
    localBox: {
      x: localBox.x,
      y: localBox.y,
      w: localBox.w,
      h: localBox.h,
      unit: 'in',
    },
    zIndex: node.zIndex,
    sourceKind,
    sourceSpan: node.sourceSpan,
    layoutConstraintEvidence: node.layoutConstraintEvidence,
    style: summarizeNodeStyle(node),
    content: summarizeNodeContent(node),
    parentNodeId,
    children: groupChildren,
    elementId: node.editableTarget?.elementId ?? node.id,
    creationId: node.editableTarget?.creationId,
    elementName: node.editableTarget?.elementName,
    semanticNodeId: node.editableTarget?.semanticNodeId,
    semanticRole: node.editableTarget?.semanticRole,
    capabilities: buildNodeToolCapabilities(sourceKind, node.editableTarget),
    referenceFrame: 'slide',
    diagnostics: node.diagnosticsRefIds ?? [],
  };
}

function flattenSpatialNodes(rootNode: SceneGraphNodeSummary): SpatialNode[] {
  const nodes: SpatialNode[] = [];
  walkSceneGraph(rootNode, (node) => {
    nodes.push({
      nodeId: node.nodeId,
      slideNumber: node.slideNumber,
      kind: toSpatialKind(node.kind),
      box: roundSpatialBox(node.box),
      localBox: roundSpatialBox(node.localBox),
      parentNodeId: node.parentNodeId,
      zIndex: node.zIndex,
      opacity: readNodeOpacity(node),
      sourceKind: node.sourceKind,
      childNodeIds: node.children.map((child) => child.nodeId),
      text: typeof node.content?.text === 'string' ? node.content.text : undefined,
      semanticNodeId: node.semanticNodeId,
      semanticRole: node.semanticRole,
    });
  });
  return nodes;
}

function toSpatialKind(kind: string): SpatialNode['kind'] {
  switch (kind) {
    case 'text':
    case 'shape':
    case 'image':
    case 'chart':
    case 'table':
    case 'group':
      return kind;
    case 'slide':
      return 'slide';
    default:
      return 'other';
  }
}

function roundSpatialBox(box: {
  x: number;
  y: number;
  w: number;
  h: number;
}): SpatialBox {
  return {
    x: round3(box.x),
    y: round3(box.y),
    w: round3(box.w),
    h: round3(box.h),
  };
}

function toLocalBox(
  box: { x: number; y: number; w: number; h: number; unit?: 'in' },
  parentBox: SpatialBox,
): SpatialBox {
  return {
    x: round3(box.x - parentBox.x),
    y: round3(box.y - parentBox.y),
    w: round3(box.w),
    h: round3(box.h),
  };
}

function summarizeNodeContent(node: RenderNode): Record<string, unknown> | undefined {
  switch (node.kind) {
    case 'text':
      return {
        text: (node.paragraphs ?? []).map((paragraph) =>
          paragraph.runs.map((run) => 'text' in run ? run.text : `[公式:${run.projection.altText}]`).join(''),
        ).join('\n'),
      };
    case 'shape':
      return node.innerText
        ? {
            text: (node.innerText.paragraphs ?? []).map((paragraph) =>
              paragraph.runs.map((run) => 'text' in run ? run.text : `[公式:${run.projection.altText}]`).join(''),
            ).join('\n'),
          }
        : undefined;
    case 'image':
      return {
        alt: node.alt,
        fitMode: node.fitMode,
        maskShape: node.maskShape,
        rounding: node.borderRadius != null && node.borderRadius > 0,
        transparency: node.opacity != null ? 1 - node.opacity : undefined,
        rotation: node.rotation,
        flipH: node.flipH,
        flipV: node.flipV,
        shadow: node.shadow,
      };
    case 'svgGraphic':
      return {
        contentHash: node.contentHash,
        viewBox: node.viewBox,
        fit: node.fit,
        altText: node.altText,
        decorative: node.decorative,
      };
    case 'formula':
      return {
        contentHash: node.contentHash,
        viewBox: node.viewBox,
        metrics: node.metrics,
        altText: node.altText,
        align: node.align,
      };
    case 'table':
      return {
        rowCount: node.rows?.length ?? 0,
        columnCount: node.columns?.length ?? 0,
      };
    case 'chart':
      return {
        chartType: node.chartType,
        seriesCount: node.series?.length ?? 0,
      };
    case 'group':
      return {
        childCount: node.children.length,
      };
  }
}

function summarizeNodeStyle(node: RenderNode): Record<string, unknown> | undefined {
  switch (node.kind) {
    case 'text':
      return {
        rotation: node.rotation,
        opacity: node.opacity,
      };
    case 'shape':
      return {
        fill: node.fill,
        stroke: node.stroke,
        shadow: node.shadow,
        rotation: node.rotation,
        opacity: node.opacity,
      };
    case 'image':
      return {
        rotation: node.rotation,
        opacity: node.opacity,
      };
    case 'svgGraphic':
    case 'formula':
      return {
        rotation: node.rotation,
        opacity: node.opacity,
      };
    case 'table':
      return {
        rotation: node.rotation,
      };
    case 'chart':
      return {
        rotation: node.rotation,
      };
    case 'group':
      return {
        rotation: node.rotation,
      };
  }
}

function readNodeOpacity(node: SceneGraphNodeSummary): number | undefined {
  const opacity = node.style?.opacity;
  return typeof opacity === 'number' ? opacity : undefined;
}
