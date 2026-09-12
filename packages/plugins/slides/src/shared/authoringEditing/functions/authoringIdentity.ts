import {
  SLIDES_AUTHORING_KEY_PATTERN,
  type SlidesAuthoringEditRef,
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

/** RenderNode.id 只用于本次渲染树；稳定作者身份仍由 authoringRef 单独承载。 */
export function buildSlidesAuthoringRenderNodeId(ref: SlidesAuthoringEditRef): string {
  return `authoring-${ref.slideKey}-${ref.editKey}`;
}
