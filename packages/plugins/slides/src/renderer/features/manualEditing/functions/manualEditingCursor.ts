import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export type ManualEditingCursor = 'default' | 'pointer' | 'move';

/** 光标只表达当前指针下的真实能力，页面空白不能伪装成可移动对象。 */
export function resolveManualEditingCursor(
  target: Pick<ManualEditableTarget, 'capabilities'> | null,
): ManualEditingCursor {
  if (!target) return 'default';
  return target.capabilities.includes('translate') ? 'move' : 'pointer';
}
