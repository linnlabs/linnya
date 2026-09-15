import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export type ManualDeleteOperation = Extract<
  SlidesManualEditOperation,
  { readonly op: 'delete_target' }
>;

/** 删除能力由编译器投影，Renderer 只把当前作者目标转换为正式操作。 */
export function createManualDeleteOperation(
  target: ManualEditableTarget,
): ManualDeleteOperation | null {
  if (!target.capabilities.includes('delete')) return null;
  return {
    op: 'delete_target',
    target: target.authoringRef,
    targetKind: target.targetKind,
  };
}
