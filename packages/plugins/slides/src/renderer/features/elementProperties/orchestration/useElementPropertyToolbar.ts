import type { DropdownActions } from '@linnya/renderer-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import type { ElementPropertyAnchor, ElementPropertyPopover, ElementPropertySize } from '../definitions/elementPropertyToolbar';
import { resolveElementPropertyPopoverPosition, resolveElementPropertyToolbarPosition } from '../functions/elementPropertyToolbarGeometry';

/** 仅拥有当前实例的浮层和 DOM 生命周期，不读取选择 store，也不消费画布指针。 */
export function useElementPropertyToolbar(options: {
  readonly anchor: Readonly<Ref<ElementPropertyAnchor>>;
  readonly deleteSelected: () => void;
  readonly dropdown: Readonly<Ref<DropdownActions | null>>;
  readonly toolbarElement: Readonly<Ref<HTMLElement | null>>;
  readonly popoverElement: Readonly<Ref<HTMLElement | null>>;
  readonly auxiliaryElement: Readonly<Ref<HTMLElement | null>>;
}) {
  const openPopover = ref<ElementPropertyPopover | null>(null);
  const toolbarSize = shallowRef<ElementPropertySize | null>(null);
  const popoverSize = shallowRef<ElementPropertySize | null>(null);
  /** 触发按钮相对浮条左边的偏移；弹层左边与它对齐，而不是整条浮条的左边。 */
  const triggerOffset = shallowRef(0);
  const position = computed(() => toolbarSize.value
    ? resolveElementPropertyToolbarPosition(options.anchor.value, toolbarSize.value)
    : null);
  const popoverPosition = computed(() => position.value && toolbarSize.value && popoverSize.value
    ? resolveElementPropertyPopoverPosition({ ...position.value, ...toolbarSize.value, left: position.value.left + triggerOffset.value }, popoverSize.value, options.anchor.value.viewport)
    : null);
  /**
   * 列表菜单 Teleport 到 body，才能让 manual 子菜单脱离舞台的 contain/overflow；
   * 根菜单仍按舞台视口约束，只把舞台坐标平移成窗口坐标。
   */
  const menuPosition = computed(() => {
    const popover = popoverPosition.value;
    const stage = options.toolbarElement.value?.offsetParent;
    if (!popover || !(stage instanceof HTMLElement)) return null;
    const origin = stage.getBoundingClientRect();
    return { ...popover, left: origin.left + stage.clientLeft + popover.left, top: origin.top + stage.clientTop + popover.top };
  });

  function close(returnFocus = false): void {
    openPopover.value = null;
    if (returnFocus) options.dropdown.value?.closeAndFocus();
  }
  async function toggle(kind: ElementPropertyPopover, event: Event): Promise<void> {
    if (openPopover.value === kind) { close(); return; }
    // 字号的触发区是“输入框 + 箭头”整体；其他弹层对齐各自按钮。
    const trigger = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest<HTMLElement>('.slides-element-property-toolbar__font') ?? event.currentTarget
      : null;
    const toolbar = options.toolbarElement.value;
    triggerOffset.value = trigger && toolbar ? trigger.getBoundingClientRect().left - toolbar.getBoundingClientRect().left : 0;
    options.dropdown.value?.open(event);
    openPopover.value = kind;
    await nextTick();
    // 字号与菜单列表由共享 CustomSelect 将焦点交给当前选项；表单面板才聚焦容器。
    if (kind === 'text' || kind === 'fill' || kind === 'size') options.popoverElement.value?.focus({ preventScroll: true });
  }
  function handoffNumberInput(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const surfaces = [options.toolbarElement.value, options.popoverElement.value, options.auxiliaryElement.value];
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
  return { openPopover, position, popoverPosition, menuPosition, toggle, close, handleToolbarKeydown };
}
