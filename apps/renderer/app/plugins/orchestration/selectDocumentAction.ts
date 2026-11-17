import type { DocumentActionMenuContribution, DocumentActionMenuContext, DocumentActionMenuOptionValue } from '../types';

/** 同一 More 菜单仍有 Host 导出/历史入口；贡献只接纳自己的 option。 */
export async function selectDocumentAction(
  menu: DocumentActionMenuContribution | null,
  value: DocumentActionMenuOptionValue,
  context: DocumentActionMenuContext,
): Promise<boolean> {
  if (!menu?.isAvailable(context)) return false;
  const option = menu.getOptions(context).find(item => item.value === value);
  if (!option) return false;
  if (!option.disabled) await menu.select(value, context);
  return true;
}
