import type { CanvasKeyboardActions } from '../definitions/canvasKeyboard';
import { readCanvasShortcut } from '../functions/readCanvasShortcut';
export function createCanvasKeyboardHandler(actions: CanvasKeyboardActions) {
  return async (event: KeyboardEvent) => {
    const command = readCanvasShortcut(event, actions.isEditing(), actions.treeMode?.() ?? false);
    if (!command) return;
    event.preventDefault();
    switch (command) {
      case 'duplicate': await actions.duplicate(); return;
      case 'undo': await actions.undo('undo'); return;
      case 'redo': await actions.undo('redo'); return;
      case 'delete': await actions.remove(); return;
      case 'edit': await actions.edit(); return;
      case 'tree-child': await actions.createTree?.('child'); return;
      case 'tree-sibling': await actions.createTree?.('sibling'); return;
      case 'escape': await actions.escape(); return;
      case 'all': await actions.select(actions.allIds()); return;
      case 'actual': actions.zoom(1); return;
      case 'fit': actions.fit(); return;
      case 'fit-selection': actions.fit(true); return;
      case 'zoom-in': actions.zoom(actions.zoomValue() * 1.25); return;
      case 'zoom-out': actions.zoom(actions.zoomValue() / 1.25); return;
      default: {
        const step = event.shiftKey ? 10 : 1;
        await actions.move(actions.selection(), command === 'left' ? -step : command === 'right' ? step : 0, command === 'up' ? -step : command === 'down' ? step : 0);
      }
    }
  };
}
