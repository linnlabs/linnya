import {
  isSlidesAuthoringObjectRef,
  type SlidesAuthoringObjectRef,
} from '@plugin/slides/shared/authoringEditing';

interface LegacyElementProjection {
  readonly element: Record<string, unknown>;
  readonly layoutNodeId: string;
  readonly authoringRef?: SlidesAuthoringObjectRef;
}

/**
 * 把 v10 以前 current DeckSpec 中的确定性 Flex 布局层级迁移为正式作者祖先。
 * 该旧字段只在一次性数据迁移中读取；Renderer 与运行时 mapper 不承担双读。
 */
export function backfillFrameAuthoringAncestors(deckSpec: unknown): boolean {
  if (!isRecord(deckSpec) || !Array.isArray(deckSpec.slides)) return false;
  let changed = false;
  for (const slide of deckSpec.slides) {
    if (!isRecord(slide) || !isRecord(slide.spec) || !Array.isArray(slide.spec.elements)) {
      continue;
    }
    const elements = slide.spec.elements
      .map(readLegacyElementProjection)
      .filter((element): element is LegacyElementProjection => element !== null);
    const frames = elements.filter(element => element.authoringRef?.targetKind === 'frame');
    for (const current of elements) {
      if (current.element._authoringAncestorRefs !== undefined) continue;
      const ancestors = frames
        .filter(frame => (
          isLayoutAncestor(frame.layoutNodeId, current.layoutNodeId)
          && (
            current.authoringRef === undefined
            || frame.authoringRef?.slideKey === current.authoringRef.slideKey
          )
        ))
        .sort((left, right) => left.layoutNodeId.length - right.layoutNodeId.length)
        .flatMap(frame => frame.authoringRef ? [frame.authoringRef] : []);
      if (ancestors.length === 0) continue;
      current.element._authoringAncestorRefs = ancestors;
      changed = true;
    }
  }
  return changed;
}

function readLegacyElementProjection(value: unknown): LegacyElementProjection | null {
  if (!isRecord(value) || !isRecord(value._layoutConstraintEvidence)) return null;
  const layoutNodeId = value._layoutConstraintEvidence.layoutNodeId;
  if (typeof layoutNodeId !== 'string' || layoutNodeId.length === 0) return null;
  return {
    element: value,
    layoutNodeId,
    ...(isSlidesAuthoringObjectRef(value._authoringRef)
      ? { authoringRef: value._authoringRef }
      : {}),
  };
}

function isLayoutAncestor(ancestorNodeId: string, descendantNodeId: string): boolean {
  return descendantNodeId.startsWith(`${ancestorNodeId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
