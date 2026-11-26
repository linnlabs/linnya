import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties, Ref } from 'vue';
import { rendererUiOverlayLayer, useEscapeLayer } from '../../overlays';
import { anchoredMotionDirection, useAnchoredPosition } from '../../anchored-position';
import type { DropdownMotionDirection } from '../../select-menu';

interface PickerPanelElement {
  readonly element: HTMLElement | null;
}

interface UsePickerPanelOptions {
  readonly anchorRef: Readonly<Ref<HTMLElement | null>>;
  readonly panelRef: Readonly<Ref<PickerPanelElement | null>>;
  readonly align: 'start' | 'end';
  /** Escape 关闭前的收尾，例如丢弃没提交的输入。 */
  readonly onEscape?: () => void;
}

interface UsePickerPanelResult {
  readonly isOpen: Readonly<Ref<boolean>>;
  readonly direction: Readonly<Ref<DropdownMotionDirection>>;
  readonly panelStyle: Readonly<Ref<CSSProperties>>;
  readonly open: () => Promise<void>;
  readonly close: () => void;
}

/** 与下拉框 Portal 面板同一间距：面板像下拉框一样贴着触发器。 */
const PICKER_PANEL_GAP = 4;

/**
 * 日期、时间面板共用的开合与定位：面板挂在 body 上按视口定位，不被滚动容器裁切；
 * 点面板和触发器以外的地方、或在本层按 Escape 时关闭。
 */
export function usePickerPanel({ anchorRef, panelRef, align, onEscape }: UsePickerPanelOptions): UsePickerPanelResult {
  const isOpen = ref(false);
  const anchored = useAnchoredPosition({
    anchor: anchorRef,
    floating: () => panelRef.value?.element,
    open: isOpen,
    placement: { side: 'bottom', align, gap: PICKER_PANEL_GAP },
  });

  /** 面板渲染并定好位才返回，调用方随后把焦点移进面板时它已在最终位置。 */
  async function open(): Promise<void> {
    if (isOpen.value) return;
    isOpen.value = true;
    await nextTick();
    await anchored.update();
  }

  function close(): void {
    isOpen.value = false;
  }

  function handlePointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (anchorRef.value?.contains(target) || panelRef.value?.element?.contains(target)) return;
    close();
  }

  function listen(method: 'addEventListener' | 'removeEventListener'): void {
    document[method]('pointerdown', handlePointerDown as EventListener, true);
  }

  watch(isOpen, opened => listen(opened ? 'addEventListener' : 'removeEventListener'));
  onBeforeUnmount(() => listen('removeEventListener'));

  useEscapeLayer({
    active: isOpen,
    onEscape: (event) => {
      event.preventDefault();
      onEscape?.();
      close();
    },
  });

  return {
    isOpen,
    direction: computed(() => anchoredMotionDirection(anchored.side.value)),
    panelStyle: computed(() => ({ ...anchored.style.value, zIndex: rendererUiOverlayLayer('portalMenu') })),
    open,
    close,
  };
}
