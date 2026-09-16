import {
  SLIDES_AUTHORING_KEY_PATTERN,
  type SlidesAuthoringEditRef,
  type SlidesAuthoringObjectRef,
} from '../definitions/authoringIdentity';

export function isSlidesAuthoringKey(value: unknown): value is string {
  return typeof value === 'string' && SLIDES_AUTHORING_KEY_PATTERN.test(value);
}

export function isSlidesAuthoringEditRef(value: unknown): value is SlidesAuthoringEditRef {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 2
    && 'slideKey' in value
    && 'editKey' in value
    && isSlidesAuthoringKey(value.slideKey)
    && isSlidesAuthoringKey(value.editKey);
}

export function isSlidesAuthoringObjectRef(value: unknown): value is SlidesAuthoringObjectRef {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 3
    && 'slideKey' in value
    && 'editKey' in value
    && 'targetKind' in value
    && isSlidesAuthoringKey(value.slideKey)
    && isSlidesAuthoringKey(value.editKey)
    && isSlidesManualTargetKind(value.targetKind);
}

/**
 * 摊平渲染节点只允许声明同一页面内的 Frame 祖先。
 * 顺序表达作者树层级，因此重复祖先同样属于无效编译结果。
 */
export function isSlidesAuthoringAncestorRefs(
  value: unknown,
  descendantRef?: SlidesAuthoringObjectRef,
): value is readonly SlidesAuthoringObjectRef[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isSlidesAuthoringObjectRef)) {
    return false;
  }
  const slideKey = descendantRef?.slideKey ?? value[0]?.slideKey;
  const editKeys = new Set<string>();
  return value.every(ref => {
    if (ref.targetKind !== 'frame' || ref.slideKey !== slideKey || editKeys.has(ref.editKey)) {
      return false;
    }
    editKeys.add(ref.editKey);
    return true;
  });
}

function isSlidesManualTargetKind(value: unknown): boolean {
  return value === 'text'
    || value === 'frame'
    || value === 'shape'
    || value === 'image'
    || value === 'table'
    || value === 'chart'
    || value === 'svgGraphic'
    || value === 'formula';
}

/** RenderNode.id 只用于本次渲染树；稳定作者身份仍由 authoringRef 单独承载。 */
export function buildSlidesAuthoringRenderNodeId(ref: SlidesAuthoringEditRef): string {
  return `authoring-${ref.slideKey}-${ref.editKey}`;
}
