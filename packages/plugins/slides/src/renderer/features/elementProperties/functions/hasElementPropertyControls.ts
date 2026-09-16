import type { ManualEditableTarget } from '../../manualEditing';

const PROPERTY_CAPABILITIES = new Set<ManualEditableTarget['capabilities'][number]>([
  'set_text_style',
  'set_fill_color',
  'set_visual_size',
]);

/** 移动专用对象不应生成遮挡画布的空属性浮层。 */
export function hasElementPropertyControls(target: ManualEditableTarget): boolean {
  return target.capabilities.some(capability => PROPERTY_CAPABILITIES.has(capability))
    || (target.targetKind === 'frame' && target.capabilities.includes('delete'));
}
