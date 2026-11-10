import { nextTick, ref } from 'vue';
import { resolveHoverTooltipPosition } from '@linnya/renderer-ui';

const GAP = 8;
/** 弹层默认朝上不挡输入区；上方放不下一屏预览且下方更宽时才朝下。 */
const PREFERRED_ROOM = 360;

/** 弹层只拥有一次hover/focus生命周期；不改引用正文或发送快照。 */
export function createComposerReferenceHover(options: { readonly anchor: () => HTMLElement | null; readonly panel: () => HTMLElement | null }) {
  const open = ref(false), position = ref<Record<string, string>>({ left: '8px', top: '8px' });
  let placement: 'top' | 'bottom' | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  function positionPanel() {
    const anchor = options.anchor(), panel = options.panel();
    if (!anchor || !panel) return;
    const trigger = anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    const above = trigger.top - GAP * 2, below = innerHeight - trigger.bottom - GAP * 2;
    // 打开期间固定一侧并贴着引用：预览异步长高、展开时只朝远离引用的方向长，不盖住鼠标触发展开，也不跳到另一侧。
    placement ??= above >= Math.min(below, PREFERRED_ROOM) ? 'top' : 'bottom';
    const { left } = resolveHoverTooltipPosition(trigger, bounds, innerWidth, placement, GAP);
    position.value = {
      left: `${left}px`,
      ...(placement === 'top' ? { bottom: `${innerHeight - trigger.top + GAP}px` } : { top: `${trigger.bottom + GAP}px` }),
      '--conversation-reference-available-height': `${Math.max(0, placement === 'top' ? above : below)}px`,
    };
  }
  const observer = new ResizeObserver(positionPanel);
  async function show() { if (disposed) return; cancel(); open.value = true; await nextTick(); const panel = options.panel(); if (open.value && panel) { observer.observe(panel); positionPanel(); } }
  function close() { cancel(); open.value = false; placement = null; observer.disconnect(); }
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
