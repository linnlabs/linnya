import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties, type Ref } from 'vue';
import type { FloatingToolbarPosition } from '@linnya/renderer-ui';
import { resolveCustomColorSubmenuPosition } from '../functions/customColorSubmenuGeometry';

/** 表单子菜单需要保留正在输入/拖动的草稿；不能沿用选项菜单「离开即关」的焦点规则。 */
export function useCustomColorSubmenu(options: {
  readonly trigger: Readonly<Ref<HTMLButtonElement | null>>;
  readonly panel: Readonly<Ref<HTMLElement | null>>;
  readonly overlayHost: Readonly<Ref<HTMLElement | null>>;
  readonly menuElement: Readonly<Ref<HTMLElement | null>>;
  readonly menuPosition: Readonly<Ref<FloatingToolbarPosition | null>>;
  readonly disabled: Readonly<Ref<boolean>>;
  readonly reset: () => void;
}) {
  const open = ref(false);
  const position = ref<FloatingToolbarPosition | null>(null);
  const viewport = ref({ width: 0, height: 0 });
  let pinned = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  function keepOpen(): void {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  }
  function close(returnFocus = false): void {
    keepOpen();
    pinned = false;
    open.value = false;
    if (returnFocus) options.trigger.value?.focus({ preventScroll: true });
  }
  function scheduleClose(): void {
    keepOpen();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!pinned && !options.panel.value?.contains(document.activeElement)) close();
    }, 200);
  }
  function measure(): void {
    const host = options.overlayHost.value;
    const menu = options.menuElement.value;
    const row = options.trigger.value;
    const panel = options.panel.value;
    const menuPosition = options.menuPosition.value;
    if (!open.value || !host || !menu || !row || !panel || !menuPosition) return;
    viewport.value = { width: host.clientWidth, height: host.clientHeight };
    const rowRect = row.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    // 用布局坐标＋相对位移抵消主菜单进场动画的 transform，避免子菜单跟着抖动。
    position.value = resolveCustomColorSubmenuPosition(
      { ...menuPosition, width: menu.offsetWidth, height: menu.offsetHeight },
      { left: menuPosition.left + rowRect.left - menuRect.left, top: menuPosition.top + rowRect.top - menuRect.top,
        width: row.offsetWidth, height: row.offsetHeight },
      { width: panel.offsetWidth, height: panel.offsetHeight }, viewport.value,
    );
  }
  async function show(focus = false): Promise<void> {
    if (options.disabled.value) return;
    keepOpen();
    if (!open.value) {
      options.reset();
      position.value = null;
      open.value = true;
    }
    if (focus) pinned = true;
    await nextTick();
    measure();
    if (focus) options.panel.value?.focus({ preventScroll: true });
  }
  function handleRowKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') { event.preventDefault(); void show(true); }
    if (event.key === 'Escape' && open.value) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }
  const observer = new ResizeObserver(measure);
  watch([options.panel, options.overlayHost, options.menuElement], elements => {
    observer.disconnect();
    for (const element of elements) if (element) observer.observe(element);
    measure();
  }, { flush: 'post' });
  watch(options.menuPosition, measure, { flush: 'post' });
  onBeforeUnmount(() => { keepOpen(); observer.disconnect(); });
  const style = computed<CSSProperties>(() => ({
    left: `${position.value?.left ?? 0}px`, top: `${position.value?.top ?? 0}px`,
    visibility: position.value ? 'visible' : 'hidden',
    maxWidth: `${Math.max(0, viewport.value.width - 16)}px`, maxHeight: `${Math.max(0, viewport.value.height - 16)}px`,
  }));
  return { open, style, show, close, keepOpen, scheduleClose, handleRowKeydown };
}
