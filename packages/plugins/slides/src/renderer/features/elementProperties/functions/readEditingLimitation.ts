import type { ManualEditableTarget } from '../../manualEditing/selection';
import type { ElementPropertyMessageKey } from '../definitions/elementPropertyMessageCatalog';

/** 身份不等于能力；复杂对象只说明当前内容编辑边界，不隐藏可用的移动和删除。 */
export function readEditingLimitation(target: ManualEditableTarget): ElementPropertyMessageKey | null {
  if (['chart', 'table', 'svgGraphic', 'formula'].includes(target.targetKind)) return 'slides.elementProperties.contentViaAi';
  if (target.targetKind === 'text' && !target.capabilities.includes('set_text_content')) return 'slides.elementProperties.formulaViaAi';
  return null;
}
