import { projectTextEditingValues } from './projectTextEditingValues';
import type { RenderNode } from '../../../types/render';
import {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
  polygonBounds,
  rectToPolygon,
  type RenderNodeSelectionGeometry,
  type RenderNodeSelectionPoint,
} from '../../renderNodeSelection';
import { createTextEditingTarget } from '../../textEditing';
import type {
  ManualEditIntent,
  ManualEditableTarget,
  ManualEditingSelectionFragment,
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';
import {
  collectManualTranslationPreviews,
  collectManualVisualPreviews,
  mergeManualTranslationPreviews,
} from './manualIntentPreviews';
import { projectManualEditableTargetSelection } from './manualVisualPreview';
import { collectEditingPreviewGeometries } from '../../editingPreview';

export interface ManualEditingHitProjection {
  readonly transientTranslation: ManualEditingTranslationPreview | null;
  readonly pendingTranslation: ManualEditingTranslationPreview | null;
  readonly pendingVisual: ManualEditingVisualPreview | null;
  readonly transientVisual?: ManualEditingVisualPreview | null;
  readonly queuedIntents: readonly ManualEditIntent[];
}

export function collectManualEditableTargets(nodes: readonly RenderNode[]): ManualEditableTarget[] {
  return collectRenderNodeSelectionGeometries(nodes, isManualEditableNode)
    .map(geometry => buildManualEditableTarget(nodes, geometry));
}

/** 原位输入也消费当前可见几何，避免刚拉伸/移动后双击时输入框回到旧位置。 */
export function createPresentedTextEditingTarget(
  nodes: readonly RenderNode[],
  target: ManualEditableTarget,
  projection: ManualEditingHitProjection,
) {
  const visuals = collectManualVisualPreviews(projection.pendingVisual, projection.queuedIntents, projection.transientVisual);
  const translations = mergeManualTranslationPreviews(collectManualTranslationPreviews(
    projection.transientTranslation, projection.pendingTranslation, projection.queuedIntents,
  ));
  const geometries = collectEditingPreviewGeometries(nodes, visuals);
  const geometry = geometries.get(target.elementId);
  if (!geometry) return null;
  const presented = projectManualEditableTargetSelection(target, translations, geometries);
  const editor = createTextEditingTarget({
    ...geometry,
    polygon: presented.polygon,
    bounds: presented.bounds,
  });
  if (!editor || !target.textEditing) return editor;
  const values = projectTextEditingValues(target.textEditing, visuals);
  return { ...editor, content: values.content, baseStyle: values.baseStyle, fontSizePt: values.fontSizePt, color: values.color };
}

export function findManualEditableTargetAtPoint(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
): ManualEditableTarget | null {
  const geometry = findRenderNodeSelectionGeometryAtPoint(nodes, point, isManualEditableNode);
  if (!geometry) return null;
  return buildManualEditableTarget(nodes, geometry);
}

export function findManualEditableTargetPathAtPoint(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
  projection?: ManualEditingHitProjection,
): readonly ManualEditableTarget[] {
  if (projection) {
    return findProjectedTargetPathAtPoint(nodes, point, projection);
  }
  const target = findManualEditableTargetAtPoint(nodes, point);
  if (!target) return [];
  return buildTargetPath(collectManualEditableTargets(nodes), target);
}

/** 预览已经改变画面时，命中也必须读取同一派生几何，不能要求用户点击旧位置。 */
function findProjectedTargetPathAtPoint(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
  projection: ManualEditingHitProjection,
): readonly ManualEditableTarget[] {
  const targets = collectManualEditableTargets(nodes);
  const translations = mergeManualTranslationPreviews(collectManualTranslationPreviews(
    projection.transientTranslation,
    projection.pendingTranslation,
    projection.queuedIntents,
  ));
  const visuals = collectManualVisualPreviews(
    projection.pendingVisual,
    projection.queuedIntents,
    projection.transientVisual,
  );
  const geometries = collectEditingPreviewGeometries(nodes, visuals);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (!target || !geometries.has(target.elementId)) continue;
    const hitPolygon = projectManualTargetHitPolygon(target, translations, geometries);
    if (isPointInsideConvexPolygon(point, hitPolygon)) {
      return buildTargetPath(targets, target);
    }
  }
  return [];
}

/** Frame 的展示框可以包住越界后代，但命中仍只认其真实背景，不能吞掉成员间空白。 */
function projectManualTargetHitPolygon(
  target: ManualEditableTarget,
  translations: ReadonlyMap<string, ManualEditingTranslationPreview>,
  geometries: ReadonlyMap<string, RenderNodeSelectionGeometry>,
): readonly RenderNodeSelectionPoint[] {
  const ownFragment = target.frameSelectionFragments
    ?.find(fragment => fragment.elementId === target.elementId);
  if (!ownFragment) {
    return projectManualEditableTargetSelection(target, translations, geometries).polygon;
  }
  return projectManualEditableTargetSelection({
    ...target,
    bounds: polygonBounds(ownFragment.polygon),
    polygon: ownFragment.polygon,
    frameSelectionFragments: undefined,
  }, translations, geometries).polygon;
}

function isPointInsideConvexPolygon(
  point: RenderNodeSelectionPoint,
  polygon: readonly RenderNodeSelectionPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) return false;
    const cross = (end.x - start.x) * (point.y - start.y)
      - (end.y - start.y) * (point.x - start.x);
    if (Math.abs(cross) <= Number.EPSILON) continue;
    const nextDirection = Math.sign(cross);
    if (direction !== 0 && direction !== nextDirection) return false;
    direction = nextDirection;
  }
  return true;
}

export function findManualEditableTargetPathByElementId(
  nodes: readonly RenderNode[],
  elementId: string,
): readonly ManualEditableTarget[] {
  const targets = collectManualEditableTargets(nodes);
  const target = targets.find(candidate => candidate.elementId === elementId);
  return target ? buildTargetPath(targets, target) : [];
}

function buildManualEditableTarget(
  nodes: readonly RenderNode[],
  geometry: RenderNodeSelectionGeometry<RenderNode & {
    authoringRef: NonNullable<RenderNode['authoringRef']>;
    authoringEdit: NonNullable<RenderNode['authoringEdit']>;
  }>,
): ManualEditableTarget {
  const { node } = geometry;
  const textEditing = createTextEditingTarget(geometry);
  const translationElementIds = node.authoringRef.targetKind === 'frame'
    ? collectFrameTranslationRoots(nodes, node.authoringRef)
    : [geometry.elementId];
  const frameSelectionFragments = node.authoringRef.targetKind === 'frame'
    ? collectFrameSelectionFragments(nodes, translationElementIds)
    : undefined;
  const selectionPolygon = frameSelectionFragments
    ? rectToPolygon(polygonBounds(frameSelectionFragments.flatMap(fragment => fragment.polygon)))
    : geometry.polygon;
  return {
    elementId: geometry.elementId,
    nodeKind: geometry.nodeKind,
    targetKind: node.authoringRef.targetKind,
    capabilities: node.authoringEdit.capabilities,
    authoringRef: {
      slideKey: node.authoringRef.slideKey,
      editKey: node.authoringRef.editKey,
    },
    authoringAncestorRefs: node.authoringAncestorRefs ?? [],
    bounds: polygonBounds(selectionPolygon),
    polygon: selectionPolygon,
    ...(frameSelectionFragments ? { frameSelectionFragments } : {}),
    translationElementIds,
    ...(textEditing ? { textEditing } : {}),
    ...(node.authoringEdit.fill ? { fill: node.authoringEdit.fill } : {}),
    ...(node.authoringEdit.capabilities.includes('set_visual_size')
      ? { visualSize: readVisualSize(geometry) }
      : {}),
  };
}

function collectFrameSelectionFragments(
  nodes: readonly RenderNode[],
  translationElementIds: readonly string[],
): readonly ManualEditingSelectionFragment[] {
  const elementIds = new Set(translationElementIds);
  return collectRenderNodeSelectionGeometries(nodes, isRenderNode)
    .filter(geometry => elementIds.has(geometry.elementId))
    .map(geometry => ({
      elementId: geometry.elementId,
      polygon: geometry.polygon,
    }));
}

function readVisualSize(geometry: RenderNodeSelectionGeometry): {
  readonly width: number;
  readonly height: number;
} {
  const origin = geometry.polygon[0];
  const horizontalEnd = geometry.polygon[1];
  const verticalEnd = geometry.polygon[3];
  if (!origin || !horizontalEnd || !verticalEnd) return { width: 0, height: 0 };
  return {
    width: Math.hypot(horizontalEnd.x - origin.x, horizontalEnd.y - origin.y),
    height: Math.hypot(verticalEnd.x - origin.x, verticalEnd.y - origin.y),
  };
}

function buildTargetPath(
  targets: readonly ManualEditableTarget[],
  target: ManualEditableTarget,
): readonly ManualEditableTarget[] {
  const ancestors = target.authoringAncestorRefs.flatMap((ancestorRef) => {
    const ancestor = targets.find(candidate => (
      candidate.targetKind === ancestorRef.targetKind
      && candidate.authoringRef.slideKey === ancestorRef.slideKey
      && candidate.authoringRef.editKey === ancestorRef.editKey
    ));
    return ancestor ? [ancestor] : [];
  });
  return ancestors.some(ancestor => ancestor.elementId === target.elementId)
    ? ancestors
    : [...ancestors, target];
}

/**
 * Frame 在 RenderModel 中仍是摊平节点。这里仅消费编译器投影的作者层级，
 * 并返回最外层渲染根，避免 Group 与 child 同时平移造成双重位移。
 */
function collectFrameTranslationRoots(
  nodes: readonly RenderNode[],
  frameRef: NonNullable<RenderNode['authoringRef']>,
): string[] {
  const roots: string[] = [];
  visit(nodes);
  return roots;

  function visit(currentNodes: readonly RenderNode[]): void {
    for (const node of currentNodes) {
      if (belongsToFrame(node, frameRef)) {
        roots.push(node.id);
        continue;
      }
      if (node.kind === 'group') visit(node.children);
    }
  }
}

function belongsToFrame(
  node: RenderNode,
  frameRef: NonNullable<RenderNode['authoringRef']>,
): boolean {
  return isSameAuthoringObject(node.authoringRef, frameRef)
    || node.authoringAncestorRefs?.some(ref => isSameAuthoringObject(ref, frameRef)) === true;
}

function isSameAuthoringObject(
  left: RenderNode['authoringRef'],
  right: NonNullable<RenderNode['authoringRef']>,
): boolean {
  return left?.slideKey === right.slideKey && left.editKey === right.editKey;
}

function isManualEditableNode(node: RenderNode): node is RenderNode & {
  authoringRef: NonNullable<RenderNode['authoringRef']>;
  authoringEdit: NonNullable<RenderNode['authoringEdit']>;
} {
  return node.authoringRef !== undefined
    && node.authoringEdit !== undefined
    && node.authoringEdit.capabilities.length > 0
    && node.locked !== true
    && !node.id.endsWith('-inner');
}

function isRenderNode(node: RenderNode): node is RenderNode {
  return true;
}
