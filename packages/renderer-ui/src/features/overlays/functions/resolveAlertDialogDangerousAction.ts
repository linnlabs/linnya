/**
 * 保留既有 AlertDialog 的危险操作推断规则。
 *
 * 这是迁移兼容行为，不代表所有产品语境都应该依赖文案推断；调用方可以通过
 * `isDangerousAction` 显式声明危险操作。
 */
export function resolveAlertDialogDangerousAction(input: {
  readonly confirmText: string;
  readonly title: string;
  readonly isDangerousAction: boolean;
}): boolean {
  if (input.isDangerousAction) return true;
  const text = `${input.confirmText} ${input.title}`.toLowerCase();
  return /删除|确认删除|delete|remove|danger/.test(text);
}
