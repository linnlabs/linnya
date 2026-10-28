import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';

/** 新建定位插入位置，复制定位其后一页；最终有效范围由新快照页数决定。 */
export function resolveSlideStructureTargetIndex(operation: SlidesManualEditCommandOperation): number | null {
  if (!('index' in operation)) return null;
  return operation.index + (operation.op === 'duplicate_slide' ? 1 : 0);
}
