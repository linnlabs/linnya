/** 画布快捷键不应抢走表单控件或原位文本编辑器的删除行为。 */
export function shouldHandleManualDeleteShortcut(
  event: Pick<KeyboardEvent, 'key' | 'target'>,
): boolean {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
  if (!(event.target instanceof Element)) return true;
  return event.target.closest('input, textarea, select, button, [contenteditable]') === null;
}
