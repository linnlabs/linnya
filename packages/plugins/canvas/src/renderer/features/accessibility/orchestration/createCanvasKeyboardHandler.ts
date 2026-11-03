import type { CanvasKeyboardActions, CanvasShortcut } from '../definitions/canvasKeyboard';
import { canvasArrowVectors } from '../definitions/canvasKeyboardBindings';
import { readCanvasShortcut } from '../functions/readCanvasShortcut';
export function createCanvasKeyboardHandler(actions: CanvasKeyboardActions) {
  const move = (key: keyof typeof canvasArrowVectors, event: KeyboardEvent) => { const vector = canvasArrowVectors[key], step = event.shiftKey ? 10 : 1; return actions.move(actions.selection(), vector.x * step, vector.y * step); };
  const handlers: Readonly<Record<CanvasShortcut, (event: KeyboardEvent) => void | Promise<void>>> = {
    duplicate: () => actions.duplicate(), undo: () => actions.undo('undo'), redo: () => actions.undo('redo'), delete: () => actions.remove(), edit: () => actions.edit(), escape: () => actions.escape(),
    'tree-child': () => actions.createTree?.('child'), 'tree-sibling': () => actions.createTree?.('sibling'), all: () => actions.select(actions.allIds()), actual: () => actions.zoom(1), fit: () => actions.fit(),
    'fit-selection': () => actions.fit(true), 'zoom-in': () => actions.zoom(actions.zoomValue() * 1.25), 'zoom-out': () => actions.zoom(actions.zoomValue() / 1.25),
    left: event => move('left', event), right: event => move('right', event), up: event => move('up', event), down: event => move('down', event),
  };
  return async (event: KeyboardEvent) => {
    const command = readCanvasShortcut(event, actions.isEditing(), actions.treeMode?.() ?? false);
    if (!command) return; event.preventDefault(); await handlers[command](event);
  };
}
