import { INCHES_TO_PX } from '../../../shared/constants';

/** 菜单、表单与富文本拥有自己的按键，画布只处理未被消费的输入。 */
export function ownsCanvasKeyboard(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  return !(event.target instanceof Element)
    || event.target.closest('input, textarea, select, button, a, [contenteditable], [role="menu"], [role="listbox"], [role="slider"]') === null;
}

/** Ctrl/Cmd 文档快捷键不与按钮自身的 Enter/Space/方向键冲突；只让给文字输入与弹出列表。 */
export function ownsDocumentShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  return !(event.target instanceof Element)
    || event.target.closest('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [role="slider"]') === null;
}

/**
 * 普通命令按钮按下时保留画布焦点，点完仍可直接用方向键、Delete 和 Esc。
 * 弹出类触发器按自身焦点模型工作；正在输入时让按钮照常取焦，先交接输入框的 change。
 */
export function preserveCanvasFocus(event: MouseEvent): void {
  if (!(event.target instanceof Element) || event.button !== 0) return;
  const button = event.target.closest('button');
  if (!button || button.hasAttribute('aria-haspopup') || button.hasAttribute('aria-expanded')) return;
  const active = document.activeElement;
  if (active instanceof Element && active.closest('input, textarea, select, [contenteditable]')) return;
  event.preventDefault();
}

export function readCanvasNudge(event: KeyboardEvent): { dx: number; dy: number } | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const step = (event.shiftKey ? 10 : 1) / INCHES_TO_PX;
  switch (event.key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}
