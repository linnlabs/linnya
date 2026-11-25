import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties, Ref } from 'vue';
import { rendererUiOverlayLayer, useEscapeLayer } from '../../overlays';
import { resolveFixedPanelPosition } from '../../select-menu';
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

/**
 * 日期、时间面板共用的开合与定位：面板挂在 body 上按视口定位，不被滚动容器裁切；
 * 点面板和触发器以外的地方、或在本层按 Escape 时关闭。
 */
export function usePickerPanel({ anchorRef, panelRef, align, onEscape }: UsePickerPanelOptions): UsePickerPanelResult {
  const isOpen = ref(false);
  const direction = ref<DropdownMotionDirection>('down');
  const panelStyle = ref<CSSProperties>({});

  function updatePosition(): void {
    const anchor = anchorRef.value;
    const panel = panelRef.value?.element;
    if (!anchor || !panel) return;
    const position = resolveFixedPanelPosition({
      anchor: anchor.getBoundingClientRect(),
      panelWidth: panel.offsetWidth,
      panelHeight: panel.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align,
    });
    direction.value = position.direction;
    panelStyle.value = {
      position: 'fixed',
      top: `${position.top}px`,
      left: `${position.left}px`,
      zIndex: rendererUiOverlayLayer('portalMenu'),
    };
  }

  async function open(): Promise<void> {
    if (isOpen.value) return;
    // 先按尺寸排好再显示，避免面板从错误的位置闪一下。
    panelStyle.value = { position: 'fixed', top: '0', left: '0', visibility: 'hidden' };
    isOpen.value = true;
    await nextTick();
    updatePosition();
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
    window[method]('resize', updatePosition);
    window[method]('scroll', updatePosition, true);
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

  return { isOpen, direction, panelStyle, open, close };
}
