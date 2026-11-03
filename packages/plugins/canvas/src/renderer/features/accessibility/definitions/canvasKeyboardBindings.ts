import type { CanvasShortcut } from './canvasKeyboard';
export const canvasModifiedKeys: Readonly<Partial<Record<string, CanvasShortcut>>> = { d: 'duplicate', a: 'all', '0': 'actual', '1': 'fit', '2': 'fit-selection', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out' };
export const canvasPlainKeys: Readonly<Partial<Record<string, CanvasShortcut>>> = { Delete: 'delete', Backspace: 'delete', Enter: 'edit', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
export const canvasArrowVectors = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } } as const;
