// 子菜单逻辑：处理悬停、位置计算、延迟关闭等

import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type {
  CustomSelectOption,
  CustomSelectOptionValue,
  DropdownPanelPositionStyle,
} from '../definitions/selectMenu';
import {
  isSubmenuAnchorVisible,
  resolveSubmenuPosition,
  submenuViewportSize,
} from '../functions/submenuGeometry';
import { RENDERER_UI_OVERLAY_LAYER_VALUES } from '../../overlays';

interface UseSubmenuOptions {
  optionsRef: Ref<HTMLElement | null>;
  submenuRef: Ref<HTMLElement | null>;
}

/**
 * 子菜单 Teleport 到 body 后不再继承原菜单的堆叠上下文，因此需要读取完整祖先链。
 * 取最高显式层级而不是最近层级，才能越过 Modal overlay 等更外层容器。
 */
export function resolveSubmenuZIndex(startEl: HTMLElement): number {
  let highestZIndex: number = RENDERER_UI_OVERLAY_LAYER_VALUES.inlineMenu;
  let el: HTMLElement | null = startEl;
  while (el && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const zIndexRaw = style.zIndex;
    const isPositioned = style.position !== 'static';
    if (isPositioned && zIndexRaw && zIndexRaw !== 'auto') {
      const zIndex = Number(zIndexRaw);
      if (!Number.isNaN(zIndex)) highestZIndex = Math.max(highestZIndex, zIndex);
    }
    el = el.parentElement;
  }
  return highestZIndex + 1;
}

/** 子菜单的显示、定位和焦点交接共用一次可取消的打开生命周期。 */
export function useSubmenu<Value extends CustomSelectOptionValue>({
  optionsRef,
  submenuRef,
}: UseSubmenuOptions) {
  const hoveredOptionWithChildren = shallowRef<CustomSelectOption<Value> | null>(null);
  const submenuPosition = ref<DropdownPanelPositionStyle>({ top: '0px', left: '0px' });
  let submenuCloseTimer: number | null = null;
  let positionAnimationFrame: number | null = null;
  let opening = 0;
  let anchor: HTMLElement | null = null;
  let onVisible: (() => void) | undefined;

  function clearSubmenuCloseTimer() {
    if (submenuCloseTimer !== null) {
      clearTimeout(submenuCloseTimer);
      submenuCloseTimer = null;
    }
  }

  function cancelPositioning() {
    opening += 1;
    onVisible = undefined;
    if (positionAnimationFrame !== null) cancelAnimationFrame(positionAnimationFrame);
    positionAnimationFrame = null;
    window.removeEventListener('scroll', handleAncestorScroll, true);
    window.removeEventListener('resize', repositionSubmenu);
  }

  function closeSubmenu() {
    cancelPositioning();
    clearSubmenuCloseTimer();
    anchor = null;
    hoveredOptionWithChildren.value = null;
  }

  function positionSubmenu() {
    const parentElement = anchor;
    const menuElement = optionsRef.value;
    const panel = submenuRef.value;
    const option = hoveredOptionWithChildren.value;
    if (!parentElement || !menuElement || !panel || !option) return false;

    const parentRect = parentElement.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (!parentElement.isConnected || !isSubmenuAnchorVisible(parentRect, menuRect, viewport)) {
      closeSubmenu();
      return false;
    }

    const size = submenuViewportSize(viewport);
    const sizeStyle =
      option.isPanel || option.isColorPicker
        ? {}
        : {
            '--linnya-ui-select-menu-available-width': `${size.width}px`,
            '--linnya-ui-select-menu-available-height': `${size.height}px`,
          };
    // 先约束再测量，不能拿长列表的自然高度定位；CSS 与 JS 共用同一视口事实。
    for (const [name, value] of Object.entries(sizeStyle)) panel.style.setProperty(name, value);

    // 父菜单进入动画含 translateY；相对 rect 抵消动画，但保留滚动造成的父项偏移。
    const offsetParent = menuElement.offsetParent;
    const fixedTop = Number.parseFloat(menuElement.style.top);
    const layoutMenuTop =
      offsetParent instanceof HTMLElement
        ? offsetParent.getBoundingClientRect().top + menuElement.offsetTop
        : Number.isFinite(fixedTop)
          ? fixedTop
          : menuRect.top;
    const parentTop = layoutMenuTop + parentRect.top - menuRect.top;
    const position = resolveSubmenuPosition({
      parent: {
        top: parentTop,
        bottom: parentTop + parentRect.height,
        left: parentRect.left,
        right: parentRect.right,
        width: parentRect.width,
        height: parentRect.height,
      },
      menu: menuRect,
      panel: panel.getBoundingClientRect(),
      viewport,
    });
    submenuPosition.value = {
      position: 'fixed',
      top: `${position.top}px`,
      left: `${position.left}px`,
      visibility: 'visible',
      zIndex: resolveSubmenuZIndex(parentElement),
      ...sizeStyle,
    };
    return true;
  }

  function schedulePosition() {
    if (!anchor || positionAnimationFrame !== null) return;
    const currentOpening = opening;
    positionAnimationFrame = requestAnimationFrame(() => {
      positionAnimationFrame = null;
      if (!positionSubmenu()) return;
      // reactive style 提交后才移焦点，且关闭／切换／卸载不能被旧回调重新抢焦点。
      void nextTick(() => {
        if (opening !== currentOpening) return;
        const ready = onVisible;
        onVisible = undefined;
        ready?.();
      });
    });
  }

  function repositionSubmenu() {
    schedulePosition();
  }

  function handleAncestorScroll(event: Event) {
    if (
      event.target === document ||
      (event.target instanceof Element && anchor && event.target.contains(anchor))
    ) {
      repositionSubmenu();
    }
  }

  async function openSubmenu(
    option: CustomSelectOption<Value>,
    parentElement: EventTarget | null,
    afterVisible?: () => void
  ) {
    clearSubmenuCloseTimer();
    if (!option.children?.length || !(parentElement instanceof HTMLElement)) {
      closeSubmenu();
      return;
    }

    if (hoveredOptionWithChildren.value === option && anchor === parentElement) {
      // 鼠标回到已展开父项时保留可见内容和焦点；键盘仍可请求进入现有子层。
      if (afterVisible) {
        onVisible = afterVisible;
        schedulePosition();
      }
      return;
    }
    cancelPositioning();
    const currentOpening = opening;
    anchor = parentElement;
    onVisible = afterVisible;
    hoveredOptionWithChildren.value = option;
    submenuPosition.value = {
      position: 'fixed',
      top: '0px',
      left: '0px',
      visibility: 'hidden',
      zIndex: resolveSubmenuZIndex(parentElement),
    };
    await nextTick();
    if (opening !== currentOpening) return;
    if (submenuRef.value) submenuRef.value.scrollTop = 0;
    window.addEventListener('scroll', handleAncestorScroll, true);
    window.addEventListener('resize', repositionSubmenu);
    schedulePosition();
  }

  function handleOptionHover(option: CustomSelectOption<Value>, event: MouseEvent) {
    void openSubmenu(option, event.currentTarget);
  }

  function handleMainMenuLeave() {
    clearSubmenuCloseTimer();
    submenuCloseTimer = window.setTimeout(closeSubmenu, 200);
  }

  onBeforeUnmount(() => {
    cancelPositioning();
    clearSubmenuCloseTimer();
  });

  return {
    hoveredOptionWithChildren,
    submenuPosition,
    openSubmenu,
    repositionSubmenu,
    handleOptionHover,
    handleMainMenuLeave,
    keepSubmenuOpen: clearSubmenuCloseTimer,
    closeSubmenu,
    forceCloseSubmenu: closeSubmenu,
  };
}
