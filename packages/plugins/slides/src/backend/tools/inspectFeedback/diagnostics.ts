import type {
  PresentationRenderModel,
  GeneratedLayoutConstraintNode,
  SceneGraphNodeSummary,
  SceneGraphSlideSummary,
  SourceLocationHint,
  SpatialAnalysisSummary,
} from '@plugin/slides/shared';
import {
  AestheticLint,
  type AestheticLintReport,
} from '../../engine/quality/AestheticLint.js';
import {
  admitDiagnosticFinding,
  getDiagnosticCodePolicy,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticNodeRef,
  type DiagnosticSourceRef,
  type QualityDiagnosticDraft,
} from '../../engine/quality/definitions';
import { renderModelToLintInfo } from '../../engine/quality/renderModelToLintInfo.js';
import { walkSceneGraph } from './sceneGraph.js';

interface DiagnosticContext {
  readonly nodeById: ReadonlyMap<string, SceneGraphNodeSummary>;
  readonly nodeByElementId: ReadonlyMap<string, SceneGraphNodeSummary>;
  readonly nodeByElementName: ReadonlyMap<string, SceneGraphNodeSummary>;
  readonly constraintNodeById: ReadonlyMap<string, ConstraintNodeContext>;
  readonly slideByNumber: ReadonlyMap<number, SceneGraphSlideSummary>;
  readonly sourceLocations?: ReadonlyMap<number, SourceLocationHint>;
}

interface ConstraintNodeContext {
  readonly node: GeneratedLayoutConstraintNode;
  readonly slideNumber: number;
  readonly sourceKind: PresentationRenderModel['sourceKind'];
}

interface CollectDiagnosticsOptions {
  readonly sourceLocations?: ReadonlyMap<number, SourceLocationHint>;
}

export function evaluateQualityAnalysis(
  renderModel: PresentationRenderModel,
): AestheticLintReport {
  return new AestheticLint().lint(renderModelToLintInfo(renderModel));
}

/** quality draft → 正式 finding 的唯一 admission 边界。 */
export function collectFindings(
  report: AestheticLintReport,
  sceneGraph: SceneGraphSlideSummary[],
  spatialAnalysis: SpatialAnalysisSummary[],
  changedSlides?: number[],
  options: CollectDiagnosticsOptions = {},
): DiagnosticFinding[] {
  const selectedSlides = changedSlides && changedSlides.length > 0
    ? new Set(changedSlides)
    : null;
  const context = buildDiagnosticContext(sceneGraph, options.sourceLocations);
  const drafts: QualityDiagnosticDraft[] = [
    ...report.layout.issues,
    ...report.aesthetic,
    ...buildEmptySlideDrafts(sceneGraph, spatialAnalysis),
  ].filter((draft) => (
    selectedSlides == null || draft.slides.some((slideNumber) => selectedSlides.has(slideNumber))
  ));

  return drafts.map((draft, index) => finalizeDiagnosticDraft(draft, index, context));
}

function finalizeDiagnosticDraft(
  draft: QualityDiagnosticDraft,
  index: number,
  context: DiagnosticContext,
): DiagnosticFinding {
  const evidence = normalizeEvidenceNodes(draft.evidence, context);
  const nodeIds = collectEvidenceNodeIds(evidence);
  const policy = getDiagnosticCodePolicy(draft.code);
  return admitDiagnosticFinding({
    findingId: buildFindingId(draft, nodeIds, index),
    ...draft,
    evidence,
    sourceRefs: buildSourceRefs(draft.slides, nodeIds, context),
    remediation: {
      disposition: policy.disposition,
      targetNodeIds: nodeIds,
      verifyWith: [...policy.verifyWith],
    },
  });
}

function buildDiagnosticContext(
  sceneGraph: readonly SceneGraphSlideSummary[],
  sourceLocations?: ReadonlyMap<number, SourceLocationHint>,
): DiagnosticContext {
  const nodeById = new Map<string, SceneGraphNodeSummary>();
  const nodeByElementId = new Map<string, SceneGraphNodeSummary>();
  const nodeByElementName = new Map<string, SceneGraphNodeSummary>();
  const constraintNodeById = new Map<string, ConstraintNodeContext>();
  const slideByNumber = new Map<number, SceneGraphSlideSummary>();
  for (const slide of sceneGraph) {
    slideByNumber.set(slide.slideNumber, slide);
    walkSceneGraph(slide.rootNode, (node) => {
      nodeById.set(node.nodeId, node);
      if (node.elementId) nodeByElementId.set(node.elementId, node);
      if (node.elementName) nodeByElementName.set(node.elementName, node);
      const parent = node.layoutConstraintEvidence?.parent;
      if (parent) {
        constraintNodeById.set(parent.nodeId, {
          node: parent,
          slideNumber: node.slideNumber,
          sourceKind: node.sourceKind,
        });
      }
      const grandparent = node.layoutConstraintEvidence?.parentConstraint?.parent;
      if (grandparent) {
        constraintNodeById.set(grandparent.nodeId, {
          node: grandparent,
          slideNumber: node.slideNumber,
          sourceKind: node.sourceKind,
        });
      }
    });
  }
  return {
    nodeById,
    nodeByElementId,
    nodeByElementName,
    constraintNodeById,
    slideByNumber,
    sourceLocations,
  };
}

function normalizeEvidenceNodes(
  evidence: DiagnosticEvidence,
  context: DiagnosticContext,
): DiagnosticEvidence {
  switch (evidence.kind) {
    case 'node_bounds':
    case 'node_size':
    case 'text_layout':
    case 'image_aspect':
    case 'chart_readability':
    case 'text_pattern':
      return { ...evidence, node: normalizeNode(evidence.node, context) };
    case 'node_overlap': {
      const nodes = evidence.nodes
        .map((node) => normalizeNode(node, context))
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
      const first = nodes[0];
      const second = nodes[1];
      if (!first || !second) throw new Error('Overlap evidence requires two nodes');
      return { ...evidence, nodes: [first, second] };
    }
    case 'origin_stacking':
      return { ...evidence, nodes: evidence.nodes.map((node) => normalizeNode(node, context)) };
    case 'constraint_delta':
      return {
        ...evidence,
        node: normalizeNode(evidence.node, context),
        parent: normalizeNode(evidence.parent, context),
      };
    case 'parent_overflow':
      return {
        ...evidence,
        parent: normalizeNode(evidence.parent, context),
        descendants: evidence.descendants.map((node) => normalizeNode(node, context)),
      };
    case 'scalar_metric':
      return evidence.node ? { ...evidence, node: normalizeNode(evidence.node, context) } : evidence;
    case 'visual_anchor':
      return {
        ...evidence,
        largestNode: normalizeNode(evidence.largestNode, context),
        ...(evidence.maxTextNode
          ? { maxTextNode: normalizeNode(evidence.maxTextNode, context) }
          : {}),
      };
    case 'color_contrast':
      return {
        ...evidence,
        textNode: normalizeNode(evidence.textNode, context),
        containerNode: normalizeNode(evidence.containerNode, context),
      };
    case 'margin_balance':
    case 'font_inventory':
    case 'font_resolution':
    case 'color_palette':
    case 'hue_drift':
    case 'slide_similarity':
    case 'content_presence':
      return evidence;
  }
}

function normalizeNode(node: DiagnosticNodeRef, context: DiagnosticContext): DiagnosticNodeRef {
  const exact = context.nodeById.get(node.nodeId)
    ?? context.nodeByElementId.get(node.nodeId)
    ?? context.nodeByElementName.get(node.nodeId);
  if (!exact) {
    const constraintNode = context.constraintNodeById.get(node.nodeId)?.node;
    if (!constraintNode) {
      throw new Error(`Diagnostic node identity cannot be resolved: ${node.nodeId}`);
    }
    return {
      nodeId: constraintNode.nodeId,
      kind: constraintNode.kind,
      label: constraintNode.label,
      finalBox: constraintNode.finalBox,
      zIndex: constraintNode.zIndex,
      ...(constraintNode.parentNodeId ? { parentNodeId: constraintNode.parentNodeId } : {}),
    };
  }
  return {
    nodeId: exact.nodeId,
    kind: exact.kind,
    label: buildSceneNodeLabel(exact),
    finalBox: { ...exact.box, unit: 'in' },
    zIndex: exact.zIndex,
    ...(exact.parentNodeId ? { parentNodeId: exact.parentNodeId } : {}),
  };
}

function buildSceneNodeLabel(node: SceneGraphNodeSummary): string {
  const content = typeof node.content?.text === 'string'
    ? node.content.text
    : typeof node.content?.alt === 'string'
      ? node.content.alt
      : node.elementName ?? node.nodeId;
  const normalized = content.replace(/\s+/g, ' ').trim() || node.nodeId;
  return normalized.length <= 40 ? normalized : `${normalized.slice(0, 39)}…`;
}

function collectEvidenceNodeIds(evidence: DiagnosticEvidence): string[] {
  let ids: readonly string[];
  switch (evidence.kind) {
    case 'node_bounds':
    case 'node_size':
    case 'text_layout':
    case 'image_aspect':
    case 'chart_readability':
    case 'text_pattern':
      ids = [evidence.node.nodeId];
      break;
    case 'node_overlap':
    case 'origin_stacking':
      ids = evidence.nodes.map((node) => node.nodeId);
      break;
    case 'constraint_delta':
      ids = [evidence.node.nodeId, evidence.parent.nodeId];
      break;
    case 'parent_overflow':
      ids = [evidence.parent.nodeId, ...evidence.descendants.map((node) => node.nodeId)];
      break;
    case 'scalar_metric':
      ids = evidence.node ? [evidence.node.nodeId] : [];
      break;
    case 'visual_anchor':
      ids = [evidence.largestNode.nodeId, ...(evidence.maxTextNode ? [evidence.maxTextNode.nodeId] : [])];
      break;
    case 'color_contrast':
      ids = [evidence.textNode.nodeId, evidence.containerNode.nodeId];
      break;
    case 'content_presence':
      ids = evidence.triggeringNodeIds;
      break;
    case 'margin_balance':
    case 'font_inventory':
    case 'font_resolution':
    case 'color_palette':
    case 'hue_drift':
    case 'slide_similarity':
      ids = [];
      break;
  }
  return [...new Set(ids)].sort();
}

function buildSourceRefs(
  slides: readonly number[],
  nodeIds: readonly string[],
  context: DiagnosticContext,
): DiagnosticSourceRef[] {
  const nodeRefs = nodeIds.flatMap((nodeId) => {
    const node = context.nodeById.get(nodeId) ?? context.nodeByElementId.get(nodeId);
    if (!node) {
      const constraint = context.constraintNodeById.get(nodeId);
      if (!constraint) return [];
      if (constraint.node.sourceSpan) {
        return [{
          precision: 'element' as const,
          slideNumber: constraint.slideNumber,
          nodeId: constraint.node.nodeId,
          locator: 'deck.js',
          startLine: constraint.node.sourceSpan.startLine,
          endLine: constraint.node.sourceSpan.endLine,
        }];
      }
      return [unavailableSourceRef(
        constraint.slideNumber,
        constraint.node.nodeId,
        constraint.sourceKind,
      )];
    }
    if (node.sourceSpan) {
      return [{
        precision: 'element' as const,
        slideNumber: node.slideNumber,
        nodeId: node.nodeId,
        locator: 'deck.js',
        startLine: node.sourceSpan.startLine,
        endLine: node.sourceSpan.endLine,
      }];
    }
    const slideLocation = context.sourceLocations?.get(node.slideNumber);
    if (slideLocation) {
      return [{
        precision: 'slide' as const,
        slideNumber: node.slideNumber,
        nodeId: node.nodeId,
        locator: slideLocation.file,
        startLine: slideLocation.startLine,
        endLine: slideLocation.endLine,
      }];
    }
    return [unavailableSourceRef(node.slideNumber, node.nodeId, node.sourceKind)];
  });
  if (nodeRefs.length > 0) return deduplicateSourceRefs(nodeRefs);

  return deduplicateSourceRefs(slides.map((slideNumber) => {
    const slideLocation = context.sourceLocations?.get(slideNumber);
    if (slideLocation) {
      return {
        precision: 'slide' as const,
        slideNumber,
        locator: slideLocation.file,
        startLine: slideLocation.startLine,
        endLine: slideLocation.endLine,
      };
    }
    const sourceKind = context.slideByNumber.get(slideNumber)?.rootNode.sourceKind;
    return unavailableSourceRef(slideNumber, undefined, sourceKind);
  }));
}

function unavailableSourceRef(
  slideNumber: number,
  nodeId: string | undefined,
  sourceKind: PresentationRenderModel['sourceKind'] | undefined,
): DiagnosticSourceRef {
  return {
    precision: 'unavailable',
    slideNumber,
    ...(nodeId ? { nodeId } : {}),
    reason: sourceKind != null && sourceKind !== 'generated'
      ? 'source_kind_unsupported'
      : 'source_location_unavailable',
  };
}

function deduplicateSourceRefs(refs: readonly DiagnosticSourceRef[]): DiagnosticSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = ref.precision === 'unavailable'
      ? `${ref.precision}:${ref.slideNumber}:${ref.nodeId ?? ''}:${ref.reason}`
      : `${ref.precision}:${ref.slideNumber}:${ref.nodeId ?? ''}:${ref.locator}:${ref.startLine}:${ref.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFindingId(
  draft: QualityDiagnosticDraft,
  nodeIds: readonly string[],
  index: number,
): string {
  return `diag:${draft.code}:${draft.slides.join('-')}:${nodeIds.join('-') || 'slide'}:${index}`;
}

function buildEmptySlideDrafts(
  sceneGraph: readonly SceneGraphSlideSummary[],
  spatialAnalysis: readonly SpatialAnalysisSummary[],
): QualityDiagnosticDraft[] {
  return spatialAnalysis.flatMap((summary) => {
    if (!summary.isEmptySlide) return [];
    const root = sceneGraph.find((slide) => slide.slideNumber === summary.slideNumber)?.rootNode;
    if (!root) return [];
    return [{
      code: 'empty_slide' as const,
      severity: 'info' as const,
      confidence: 'high' as const,
      slides: [summary.slideNumber],
      evidence: {
        kind: 'content_presence' as const,
        expectedContent: 'renderable_content' as const,
        inspectedRegion: root.box,
        observedCount: 0,
        triggeringNodeIds: [],
      },
    }];
  });
}
