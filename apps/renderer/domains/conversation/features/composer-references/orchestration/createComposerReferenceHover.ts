import { computed, ref } from 'vue';
import { useAnchoredPosition } from '@linnya/renderer-ui';
import type { AnchoredSide } from '@linnya/renderer-ui';
import { createHoverPreviewSchedule } from '@shared/hover-preview';
import { COMPOSER_REFERENCE_HOVER_GAP, resolveComposerReferenceHoverSide } from '../functions/resolveComposerReferenceHoverSide';

/**
 * 弹层只拥有一次hover/focus生命周期；不改引用正文或发送快照。须在组件 setup 中创建，定位随组件卸载停止。
 * 时序与编辑器里的文档引用共用（shared/hover-preview）：先挂载但不可见，到露出时间且内容排好才显示。
 */
export function createComposerReferenceHover(options: {
  readonly anchor: () => HTMLElement | null;
  readonly panel: () => HTMLElement | null;
  /** 弹层内容是否由贡献的预览组件异步排版并发出 ready；纯文字内容挂上即就绪。 */
  readonly awaitsReady: () => boolean;
}) {
  // open：弹层已挂载（可能还不可见）；revealed：已到露出时机。
  const open = ref(false),
    revealed = ref(false);
  const side = ref<AnchoredSide>('top');
  // 打开期间固定一侧（flip: false）：预览异步长高、展开时不跳到另一侧盖住正停在引用上的鼠标。
  const anchored = useAnchoredPosition({
    anchor: options.anchor,
    floating: options.panel,
    open,
    placement: () => ({ side: side.value, align: 'center', gap: COMPOSER_REFERENCE_HOVER_GAP, flip: false, fitViewportHeight: true }),
  });
  const position = computed(() => {
    const { maxHeight, top, ...style } = anchored.style.value;
    const anchor = options.anchor();
    return {
      ...style,
      // 朝上时固定下沿而不是上沿：内容变高只往远离引用的方向长。固定上沿要等下一次重算才挪回去，
      // 中间那一帧弹层会盖住停在引用上的鼠标，被当成“移入预览”而自动展开。
      ...(side.value === 'top' && anchor
        ? { bottom: `${document.documentElement.clientHeight - anchor.getBoundingClientRect().top + COMPOSER_REFERENCE_HOVER_GAP}px` }
        : { top }),
      // 位置没算好或内容没排好时不可见：不可见的元素也不接收指针，不会误判移入。
      visibility: revealed.value && anchored.isPositioned.value ? ('visible' as const) : ('hidden' as const),
      // 可用高度交给内层滚动区（AiAssistantQuotePreview.css），外层只负责定位。
      ...(maxHeight === undefined ? {} : { '--conversation-reference-available-height': maxHeight }),
    };
  });
  const schedule = createHoverPreviewSchedule({
    prepare() {
      const anchor = options.anchor();
      if (!anchor) return;
      side.value = resolveComposerReferenceHoverSide(anchor.getBoundingClientRect(), innerHeight);
      open.value = true;
      if (!options.awaitsReady()) schedule.ready();
    },
    reveal() {
      revealed.value = true;
    },
    close() {
      open.value = false;
      revealed.value = false;
    },
  });
  function outside(event: Event) {
    const target = event.target;
    if (!(target instanceof Node) || options.anchor()?.contains(target) || options.panel()?.contains(target)) return;
    schedule.close();
  }
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  window.addEventListener('blur', schedule.close);
  return {
    open,
    position,
    enter: schedule.enter,
    leave: schedule.leave,
    stay: schedule.stay,
    ready: schedule.ready,
    close: schedule.close,
    escape() {
      schedule.close();
      options.anchor()?.focus();
    },
    dispose() {
      schedule.close();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', schedule.close);
    },
  };
}
