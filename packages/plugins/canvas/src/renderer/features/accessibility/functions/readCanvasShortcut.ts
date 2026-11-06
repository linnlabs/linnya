import type { CanvasShortcut } from '../definitions/canvasKeyboard';
import { canvasModifiedKeys, canvasPlainKeys } from '../definitions/canvasKeyboardBindings';
function isOtherControl(event: KeyboardEvent): boolean {
  return (
    event.key !== 'Escape' &&
    event.target instanceof HTMLElement &&
    Boolean(event.target.closest('input, textarea, select, button, [role="combobox"]'))
  );
}
function modified(event: KeyboardEvent): CanvasShortcut | null {
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return canvasModifiedKeys[key] ?? null;
}
function ordinary(event: KeyboardEvent, treeMode: boolean): CanvasShortcut | null {
  if (treeMode && event.key === 'Tab' && !event.shiftKey) return 'tree-child';
  if (treeMode && event.key === 'Enter') return 'tree-sibling';
  if (event.key === 'Tab') return 'navigate';
  return canvasPlainKeys[event.key] ?? null;
}
export function readCanvasShortcut(
  event: KeyboardEvent,
  editing: boolean,
  treeMode = false
): CanvasShortcut | null {
  if (event.isComposing || isOtherControl(event)) return null;
  if (event.key === 'Escape') return 'escape';
  if (editing) return null;
  return event.metaKey || event.ctrlKey ? modified(event) : ordinary(event, treeMode);
}
