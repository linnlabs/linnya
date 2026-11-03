import type { Editor } from '@tiptap/core';
import type { EmbeddedMarkdownNavigationIntent } from '@linnya/plugin-host-contract/renderer/embeddedMarkdownEditor';
import type { createEmbeddedMarkdownSpaceInput } from './createEmbeddedMarkdownSpaceInput';

export function installEmbeddedMarkdownNavigation(options: { readonly element: HTMLElement; readonly editor: Editor; readonly space: ReturnType<typeof createEmbeddedMarkdownSpaceInput>; readonly navigate: (intent: EmbeddedMarkdownNavigationIntent) => void }) {
  const { element, editor, space, navigate } = options;
  let active: { readonly pointer: number; readonly x: number; readonly y: number; lastX: number; lastY: number; moved: boolean } | null = null;
  const cancel = () => { const gesture = active; active = null; space.reset(); if (gesture && element.hasPointerCapture(gesture.pointer)) element.releasePointerCapture(gesture.pointer); };
  const down = (event: PointerEvent) => {
    if (!(space.held && event.button === 0 || event.button === 1) || editor.view.composing) return;
    event.preventDefault(); event.stopPropagation();
    active = { pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false }; element.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const gesture = active; if (!gesture || gesture.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 3) return;
    if (!gesture.moved) { space.revert(editor.view); gesture.moved = true; }
    navigate({ kind: 'pan', dx: event.clientX - gesture.lastX, dy: event.clientY - gesture.lastY }); gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  };
  const up = (event: PointerEvent) => { if (event.pointerId !== active?.pointer) return; event.preventDefault(); event.stopPropagation(); cancel(); };
  const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); event.stopPropagation(); navigate({ kind: 'zoom', clientX: event.clientX, clientY: event.clientY, deltaY: event.deltaY }); };
  const keyDown = (event: KeyboardEvent) => { if (event.isComposing) return; if (event.code === 'Space') space.hold(); if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); cancel(); } };
  const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') space.reset(); };
  element.addEventListener('pointerdown', down, true); element.addEventListener('pointermove', move, true); element.addEventListener('pointerup', up, true); element.addEventListener('pointercancel', cancel);
  element.addEventListener('wheel', wheel, { passive: false, capture: true }); element.addEventListener('compositionstart', cancel);
  window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', cancel);
  return { cancel, dispose() {
    cancel(); element.removeEventListener('pointerdown', down, true); element.removeEventListener('pointermove', move, true); element.removeEventListener('pointerup', up, true); element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('wheel', wheel, true); element.removeEventListener('compositionstart', cancel); window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', cancel);
  } };
}
