import { nextTick, ref } from 'vue';
import { resolveHoverTooltipPosition } from '@linnya/renderer-ui';

/** 弹层只拥有一次hover/focus生命周期；不改引用正文或发送快照。 */
export function createComposerReferenceHover(options: { readonly anchor: () => HTMLElement | null; readonly panel: () => HTMLElement | null }) {
  const open = ref(false), position = ref({ left: '8px', top: '8px' });
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  function positionPanel() {
    const anchor = options.anchor(), panel = options.panel();
    if (!anchor || !panel) return;
    const trigger = anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    const placement = trigger.top >= bounds.height + 8 ? 'top' : 'bottom';
    const point = resolveHoverTooltipPosition(trigger, bounds, innerWidth, placement, 8);
    position.value = { left: `${point.left}px`, top: `${Math.max(8, Math.min(point.top, innerHeight - bounds.height - 8))}px` };
  }
  const observer = new ResizeObserver(positionPanel);
  async function show() { if (disposed) return; cancel(); open.value = true; await nextTick(); const panel = options.panel(); if (open.value && panel) { observer.observe(panel); positionPanel(); } }
  function close() { cancel(); open.value = false; observer.disconnect(); }
  function outside(event: Event) {
    const target = event.target;
    if (!(target instanceof Node) || options.anchor()?.contains(target) || options.panel()?.contains(target)) return;
    close();
  }
  document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); window.addEventListener('blur', close); window.addEventListener('resize', positionPanel);
  return { open, position,
    enter(immediate = false) { cancel(); if (disposed || open.value) return; if (immediate) void show(); else timer = setTimeout(() => { void show(); }, 400); },
    leave() { cancel(); timer = setTimeout(close, 200); }, stay: cancel, close,
    escape() { close(); options.anchor()?.focus(); },
    dispose() { disposed = true; close(); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); window.removeEventListener('blur', close); window.removeEventListener('resize', positionPanel); },
  };
}
