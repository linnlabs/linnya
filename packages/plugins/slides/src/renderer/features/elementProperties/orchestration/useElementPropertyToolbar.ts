import type { DropdownActions } from '@linnya/renderer-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import type { ElementPropertyAnchor, ElementPropertyPopover, ElementPropertySize } from '../definitions/elementPropertyToolbar';
import { resolveElementPropertyPopoverPosition, resolveElementPropertyToolbarPosition } from '../functions/elementPropertyToolbarGeometry';

/** 仅拥有当前实例的浮层和 DOM 生命周期，不读取选择 store，也不消费画布指针。 */
export function useElementPropertyToolbar(options: {
  readonly anchor: Readonly<Ref<ElementPropertyAnchor>>;
  readonly deleteSelected: () => void;
  readonly dropdown: Readonly<Ref<DropdownActions | null>>;
  readonly hasHierarchy: Readonly<Ref<boolean>>;
  readonly toolbarElement: Readonly<Ref<HTMLElement | null>>;
  readonly popoverElement: Readonly<Ref<HTMLElement | null>>;
}) {
  const openPopover = ref<ElementPropertyPopover | null>(null);
  const toolbarSize = shallowRef<ElementPropertySize | null>(null);
  const popoverSize = shallowRef<ElementPropertySize | null>(null);
  const position = computed(() => toolbarSize.value
    ? resolveElementPropertyToolbarPosition(options.anchor.value, toolbarSize.value, options.hasHierarchy.value)
    : null);
  const popoverPosition = computed(() => position.value && toolbarSize.value && popoverSize.value
    ? resolveElementPropertyPopoverPosition({ ...position.value, ...toolbarSize.value }, popoverSize.value, options.anchor.value.viewport)
    : null);

  function close(returnFocus = false): void {
    openPopover.value = null;
    if (returnFocus) options.dropdown.value?.closeAndFocus();
  }
  async function toggle(kind: ElementPropertyPopover, event: MouseEvent): Promise<void> {
    if (openPopover.value === kind) { close(); return; }
    options.dropdown.value?.open(event);
    openPopover.value = kind;
    await nextTick();
    options.popoverElement.value?.focus({ preventScroll: true });
  }
  function handoffNumberInput(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const surfaces = [options.toolbarElement.value, options.popoverElement.value];
    if (surfaces.some(surface => surface?.contains(target))) return;
    // 先交接数字 change，再让这一次指针事件继续选择 B；不能在切换后把 A 的草稿写给 B。
    const active = document.activeElement;
    if (active instanceof HTMLElement && surfaces.some(surface => surface?.contains(active))) active.blur();
  }
  function handleToolbarKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    // Stage 对普通按钮默认屏蔽删除；这里是属性工具条的显式用户意图，交回同一删除入口。
    if (!openPopover.value && !(event.target instanceof HTMLInputElement)
      && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      options.deleteSelected();
    }
  }
  function measure(element: HTMLElement | null, size: Ref<ElementPropertySize | null>): void {
    if (!element) { size.value = null; return; }
    const rect = element.getBoundingClientRect();
    if (size.value?.width !== rect.width || size.value?.height !== rect.height) {
      size.value = { width: rect.width, height: rect.height };
    }
  }
  const observer = new ResizeObserver(() => {
    measure(options.toolbarElement.value, toolbarSize);
    measure(options.popoverElement.value, popoverSize);
  });
  watch([options.toolbarElement, options.popoverElement], ([toolbar, popover]) => {
    observer.disconnect();
    for (const element of [toolbar, popover]) if (element) observer.observe(element);
    measure(toolbar, toolbarSize);
    measure(popover, popoverSize);
  }, { flush: 'post' });
  watch(position, value => { if (!value) close(); });
  onMounted(() => document.addEventListener('pointerdown', handoffNumberInput, true));
  onBeforeUnmount(() => {
    observer.disconnect();
    document.removeEventListener('pointerdown', handoffNumberInput, true);
  });
  return { openPopover, position, popoverPosition, toggle, close, handleToolbarKeydown };
}
