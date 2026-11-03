import type { CanvasShortcut } from '../definitions/canvasKeyboard';

export function readCanvasShortcut(event: KeyboardEvent, editing: boolean, treeMode = false): CanvasShortcut | null {
  if (event.isComposing) return null;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [role="combobox"]') && event.key !== 'Escape') return null;
  if (event.key === 'Escape') return 'escape';
  if (editing) return null;
  if (event.metaKey || event.ctrlKey) {
    switch (event.key.toLowerCase()) {
      case 'd': return 'duplicate';
      case 'z': return event.shiftKey ? 'redo' : 'undo';
      case 'a': return 'all'; case '0': return 'actual'; case '1': return 'fit'; case '2': return 'fit-selection';
      case '+': case '=': return 'zoom-in'; case '-': return 'zoom-out'; default: return null;
    }
  }
  if (treeMode && event.key === 'Tab' && !event.shiftKey) return 'tree-child';
  if (treeMode && event.key === 'Enter') return 'tree-sibling';
  switch (event.key) {
    case 'Delete': case 'Backspace': return 'delete'; case 'Enter': return 'edit';
    case 'ArrowLeft': return 'left'; case 'ArrowRight': return 'right'; case 'ArrowUp': return 'up'; case 'ArrowDown': return 'down';
    default: return null;
  }
}
