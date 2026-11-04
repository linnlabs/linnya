import type { RegisterEditorFocusPortal } from '../definitions/editorFocusPortal';

/** 同一编辑器的正文和外置浮层共享焦点边界，不把浮层内容纳入ProseMirror正文。 */
export function createEditorFocusBoundary(host: HTMLElement, onLeave: () => void) {
  const roots = new Set<HTMLElement>([host]);
  const contains = (target: EventTarget | null) => target instanceof Node && [...roots].some(root => root.contains(target));
  const focusLeft = (event: FocusEvent) => { if (!contains(event.relatedTarget)) onLeave(); };
  host.addEventListener('focusout', focusLeft);
  const registerPortal: RegisterEditorFocusPortal = element => {
    roots.add(element); element.addEventListener('focusout', focusLeft);
    return () => {
      if (!roots.delete(element)) return;
      element.removeEventListener('focusout', focusLeft);
      // Chromium移除仍聚焦的DOM不会补发blur；关闭浮层也必须结束这次编辑交互。
      const active = element.ownerDocument.activeElement;
      if (active && element.contains(active) && !contains(active)) onLeave();
    };
  };
  return { registerPortal, destroy() { for (const root of roots) root.removeEventListener('focusout', focusLeft); roots.clear(); } };
}
