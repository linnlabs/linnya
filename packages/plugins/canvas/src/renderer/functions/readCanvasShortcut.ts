export type CanvasShortcut = 'delete' | 'edit' | 'escape' | 'all' | 'actual' | 'fit' | 'fit-selection' | 'zoom-in' | 'zoom-out' | 'left' | 'right' | 'up' | 'down';

export function readCanvasShortcut(event: KeyboardEvent, editing: boolean): CanvasShortcut | null {
  if (event.isComposing) return null;
  if (event.key === 'Escape') return 'escape';
  if (editing) return null;
  if (event.metaKey || event.ctrlKey) {
    switch (event.key.toLowerCase()) {
      case 'a': return 'all'; case '0': return 'actual'; case '1': return 'fit'; case '2': return 'fit-selection';
      case '+': case '=': return 'zoom-in'; case '-': return 'zoom-out'; default: return null;
    }
  }
  switch (event.key) {
    case 'Delete': case 'Backspace': return 'delete'; case 'Enter': return 'edit';
    case 'ArrowLeft': return 'left'; case 'ArrowRight': return 'right'; case 'ArrowUp': return 'up'; case 'ArrowDown': return 'down';
    default: return null;
  }
}
