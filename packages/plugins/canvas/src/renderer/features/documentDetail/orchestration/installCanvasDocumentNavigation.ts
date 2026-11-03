import type { CanvasDocumentDetailPort } from '../definitions/documentDetail';

/** 只读 DOM 不需要编辑器的 Space 事务回退；普通滚轮继续滚动详情。 */
export function installCanvasDocumentNavigation(host: HTMLElement, navigate: CanvasDocumentDetailPort['navigate']) {
  let space = false, drag: { pointerId: number; x: number; y: number } | null = null;
  const clear = () => { if (drag && host.hasPointerCapture(drag.pointerId)) host.releasePointerCapture(drag.pointerId); drag = null; space = false; host.style.cursor = ''; };
  const downKey = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.isComposing || event.target instanceof Element && event.target.closest('button,input,textarea,select,[contenteditable=true]')) return;
    event.preventDefault(); space = true;
  };
  const upKey = (event: KeyboardEvent) => { if (event.code === 'Space') clear(); };
  const down = (event: PointerEvent) => {
    if (event.button !== 1 && !(event.button === 0 && space)) return;
    event.preventDefault(); drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }; host.setPointerCapture(event.pointerId); host.style.cursor = 'grabbing';
  };
  const move = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    navigate({ kind: 'pan', dx: event.clientX - drag.x, dy: event.clientY - drag.y }); drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault(); navigate({ kind: 'zoom', clientX: event.clientX, clientY: event.clientY, deltaY: event.deltaY });
  };
  host.addEventListener('keydown', downKey); host.ownerDocument.addEventListener('keyup', upKey);
  host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', clear); host.addEventListener('pointercancel', clear);
  host.addEventListener('wheel', wheel, { passive: false }); host.ownerDocument.defaultView?.addEventListener('blur', clear);
  return () => { clear(); host.removeEventListener('keydown', downKey); host.ownerDocument.removeEventListener('keyup', upKey); host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', clear); host.removeEventListener('pointercancel', clear); host.removeEventListener('wheel', wheel); host.ownerDocument.defaultView?.removeEventListener('blur', clear); };
}
