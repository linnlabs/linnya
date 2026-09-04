import { buildSlideSourceSpanLocusKey } from '@plugin/slides/shared';
import type {
  PresentationRenderModel,
  SceneGraphNodeSummary,
  SlideSourceSpan,
  SourceLocationHint,
} from '@plugin/slides/shared';
import type {
  DiagnosticNodeRef,
  DiagnosticSourceRef,
} from '../../engine/quality/definitions';

/** SceneGraph 节点到诊断定位事实的唯一投影，finding 与 focus 共用。 */
export function toSceneDiagnosticNodeRef(node: SceneGraphNodeSummary): DiagnosticNodeRef {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    label: buildSceneNodeLabel(node),
    finalBox: { ...node.box, unit: 'in' },
    zIndex: node.zIndex,
    ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
  };
}

export function buildSceneNodeDiagnosticSourceRef(
  node: SceneGraphNodeSummary,
  sourceLocation: SourceLocationHint | undefined,
  sourceSpanUseCounts: ReadonlyMap<string, number>,
): DiagnosticSourceRef {
  if (node.sourceSpan) {
    return buildCreationDiagnosticSourceRef({
      slideNumber: node.slideNumber,
      nodeId: node.nodeId,
      sourceSpan: node.sourceSpan,
      useCounts: sourceSpanUseCounts,
    });
  }
  if (sourceLocation) {
    return {
      kind: 'slide',
      slideNumber: node.slideNumber,
      nodeId: node.nodeId,
      locator: sourceLocation.file,
      startLine: sourceLocation.startLine,
      endLine: sourceLocation.endLine,
    };
  }
  return buildUnavailableDiagnosticSourceRef(node.slideNumber, node.nodeId, node.sourceKind);
}

export function buildCreationDiagnosticSourceRef(input: {
  readonly slideNumber: number;
  readonly nodeId: string;
  readonly sourceSpan: SlideSourceSpan;
  readonly useCounts: ReadonlyMap<string, number>;
}): DiagnosticSourceRef {
  const generatedNodeCount = input.useCounts.get(
    buildSlideSourceSpanLocusKey(input.sourceSpan),
  ) ?? 1;
  if (generatedNodeCount === 1) {
    return {
      kind: 'direct_creation',
      slideNumber: input.slideNumber,
      nodeId: input.nodeId,
      locator: 'deck.js',
      startLine: input.sourceSpan.startLine,
      endLine: input.sourceSpan.endLine,
      generatedNodeCount: 1,
    };
  }
  return {
    kind: 'shared_creation',
    slideNumber: input.slideNumber,
    nodeId: input.nodeId,
    locator: 'deck.js',
    startLine: input.sourceSpan.startLine,
    endLine: input.sourceSpan.endLine,
    generatedNodeCount,
  };
}

export function buildUnavailableDiagnosticSourceRef(
  slideNumber: number,
  nodeId: string | undefined,
  sourceKind: PresentationRenderModel['sourceKind'] | undefined,
): DiagnosticSourceRef {
  return {
    kind: 'unavailable',
    slideNumber,
    ...(nodeId ? { nodeId } : {}),
    reason: sourceKind != null && sourceKind !== 'generated'
      ? 'source_kind_unsupported'
      : 'source_location_unavailable',
  };
}

export function deduplicateDiagnosticSourceRefs(
  refs: readonly DiagnosticSourceRef[],
): DiagnosticSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = ref.kind === 'unavailable'
      ? `${ref.kind}:${ref.slideNumber}:${ref.nodeId ?? ''}:${ref.reason}`
      : `${ref.kind}:${ref.slideNumber}:${ref.nodeId ?? ''}:${ref.locator}:${ref.startLine}:${ref.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
