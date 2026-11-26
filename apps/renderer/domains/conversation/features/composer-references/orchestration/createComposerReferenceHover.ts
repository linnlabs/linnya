import { computed, ref } from 'vue';
import { useAnchoredPosition } from '@linnya/renderer-ui';
import type { AnchoredSide } from '@linnya/renderer-ui';
import { COMPOSER_REFERENCE_HOVER_GAP, resolveComposerReferenceHoverSide } from '../functions/resolveComposerReferenceHoverSide';

/** 弹层只拥有一次hover/focus生命周期；不改引用正文或发送快照。须在组件 setup 中创建，定位随组件卸载停止。 */
export function createComposerReferenceHover(options: { readonly anchor: () => HTMLElement | null; readonly panel: () => HTMLElement | null }) {
  const open = ref(false);
  const side = ref<AnchoredSide>('top');
  // 打开期间固定一侧（flip: false）：预览异步长高、展开时只朝远离引用的方向长，不盖住鼠标触发展开，也不跳到另一侧。
  const anchored = useAnchoredPosition({
    anchor: options.anchor,
    floating: options.panel,
    open,
    placement: () => ({ side: side.value, align: 'center', gap: COMPOSER_REFERENCE_HOVER_GAP, flip: false, fitViewportHeight: true }),
  });
  // 可用高度交给内层滚动区（AiAssistantQuotePreview.css），外层只负责定位。
  const position = computed(() => {
    const { maxHeight, ...style } = anchored.style.value;
    return maxHeight === undefined ? style : { ...style, '--conversation-reference-available-height': maxHeight };
  });
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  function show() {
    const anchor = options.anchor();
    if (disposed || !anchor) return;
    cancel();
    side.value = resolveComposerReferenceHoverSide(anchor.getBoundingClientRect(), innerHeight);
    open.value = true;
  }
  function close() { cancel(); open.value = false; }
  function outside(event: Event) {
    const target = event.target;
    if (!(target instanceof Node) || options.anchor()?.contains(target) || options.panel()?.contains(target)) return;
    close();
  }
  document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); window.addEventListener('blur', close);
  return { open, position,
    enter(immediate = false) { cancel(); if (disposed || open.value) return; if (immediate) show(); else timer = setTimeout(show, 400); },
    leave() { cancel(); timer = setTimeout(close, 200); }, stay: cancel, close,
    escape() { close(); options.anchor()?.focus(); },
    dispose() { disposed = true; close(); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); window.removeEventListener('blur', close); },
  };
}
