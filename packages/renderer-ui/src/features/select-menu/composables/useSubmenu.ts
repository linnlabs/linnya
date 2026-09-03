// useSubmenu.js
// 子菜单逻辑：处理悬停、位置计算、延迟关闭等

import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type {
  CustomSelectOption,
  CustomSelectOptionValue,
  DropdownPanelPositionStyle,
} from '../definitions/selectMenu';
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

/**
 * 子菜单逻辑组合式函数
 * @param {Object} refs - 需要的 ref 对象
 * @param {Object} refs.optionsRef - 主选项面板的 ref
 * @param {Object} refs.submenuRef - 子菜单面板的 ref
 * @returns {Object} 返回状态和方法
 */
export function useSubmenu<Value extends CustomSelectOptionValue>({
  optionsRef,
  submenuRef,
}: UseSubmenuOptions) {
  // 当前悬停的带子菜单的选项
  const hoveredOptionWithChildren = shallowRef<CustomSelectOption<Value> | null>(null);
  
  // 子菜单位置
  const submenuPosition = ref<DropdownPanelPositionStyle>({ top: '0px', left: '0px' });
  
  // 用于延迟关闭子菜单的定时器
  let submenuCloseTimer: ReturnType<typeof window.setTimeout> | null = null;
  let positionAnimationFrame: number | null = null;

  /**
   * 计算子菜单位置
   */
  const calculateSubmenuPosition = (parentElement: HTMLElement) => {
    if (!parentElement || !optionsRef?.value) return;
    
    const parentRect = parentElement.getBoundingClientRect();
    const menuElement = optionsRef.value;
    const menuRect = menuElement.getBoundingClientRect();
    
    // 视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 获取实际子菜单尺寸（如果已渲染）
    let submenuWidth = 240; // 默认宽度
    let submenuHeight = 200; // 默认高度
    
    if (submenuRef?.value) {
      const submenuRect = submenuRef.value.getBoundingClientRect();
      if (submenuRect.width > 0) {
        submenuWidth = submenuRect.width;
      }
      if (submenuRect.height > 0) {
        submenuHeight = submenuRect.height;
      }
    }
    
    /**
     * 子菜单水平锚点策略（兼容“原有视觉间距” + 修复边缘跑偏）
     *
     * 中文说明：
     * - 你们原来的视觉效果是：子菜单与“主菜单面板边缘”保持固定间距（使用 menuRect.right/left）。
     * - 问题出现在：主菜单本体靠近窗口边缘时会越界，子菜单为了可见被 clamp 回视口，导致看起来“跑很远”。
     * - 兼容方案：
     *   - 当主菜单面板在视口内：继续以 menuRect 为锚点（保留原本中间距离）。
     *   - 当主菜单越界：退回以当前 hover 的菜单项（parentRect）为锚点，尽量贴近父项，避免大位移。
     */
    const padding = 8;
    const gap = 4;

    const clamp = (value: number, min: number, max: number) => (
      Math.min(Math.max(value, min), max)
    );

    // 水平：优先右侧，否则左侧，最后兜底 clamp
    const menuIsWithinViewport =
      menuRect.left >= padding && menuRect.right <= viewportWidth - padding;

    const anchorRight = menuIsWithinViewport ? menuRect.right : parentRect.right;
    const anchorLeft = menuIsWithinViewport ? menuRect.left : parentRect.left;

    const idealRight = anchorRight + gap;
    const maxLeft = viewportWidth - submenuWidth - padding;
    const placeLeft = idealRight > maxLeft;

    /**
     * 主菜单进入动画使用 translateY，视觉 rect 会在 150ms 内持续变化。
     * 先取得不受动画影响的菜单布局顶部，再叠加父项相对菜单的可见偏移：两者的 rect
     * 共享同一个 transform，做差后动画位移会抵消；父项因菜单滚动产生的位移则会保留。
     * 不能直接累加 parentElement.offsetTop，否则菜单滚动后会漏掉 scrollTop。
     */
    const menuOffsetParent = menuElement.offsetParent;
    const fixedMenuTop = Number.parseFloat(menuElement.style.top);
    const layoutMenuTop = menuOffsetParent instanceof globalThis.HTMLElement
      ? menuOffsetParent.getBoundingClientRect().top + menuElement.offsetTop
      : Number.isFinite(fixedMenuTop)
        ? fixedMenuTop
        : menuRect.top;
    const layoutParentTop = layoutMenuTop + parentRect.top - menuRect.top;

    /**
     * 垂直锚点必须跟随父项，而不是仅把子菜单夹进视口：
     * - 父项下方放得下时，子菜单顶部与父项顶部对齐；
     * - 顶部对齐会越过视口、但父项上方放得下时，改为底部与父项底部对齐；
     * - 两种对齐都会越界时，才围绕父项垂直居中，并限制在视口内。
     *
     * 直接 clamp 顶部对齐坐标会丢失第二条语义：底部菜单项打开较高的子菜单时，
     * 子菜单会被推到视口底部，看起来悬在父项中段，而不是明确地底部对齐。
     */
    const viewportTop = padding;
    const viewportBottom = viewportHeight - padding;
    const layoutParentBottom = layoutParentTop + parentRect.height;
    const topAlignedTop = layoutParentTop;
    const bottomAlignedTop = layoutParentBottom - submenuHeight;
    const centeredTop = layoutParentTop + (parentRect.height - submenuHeight) / 2;
    const maxTop = viewportBottom - submenuHeight;

    let finalTop: number;
    if (topAlignedTop >= viewportTop && topAlignedTop + submenuHeight <= viewportBottom) {
      finalTop = topAlignedTop;
    } else if (bottomAlignedTop >= viewportTop && layoutParentBottom <= viewportBottom) {
      finalTop = bottomAlignedTop;
    } else if (maxTop >= viewportTop) {
      finalTop = clamp(centeredTop, viewportTop, maxTop);
    } else {
      // 子菜单本身高于可用视口时，只能让上下溢出量相等，保持真正的居中语义。
      finalTop = (viewportTop + maxTop) / 2;
    }

    // 子菜单层级：高于触发元素完整祖先链中的最高显式 z-index。
    const zIndex = resolveSubmenuZIndex(parentElement);
    
    // 构造样式对象
    const style: DropdownPanelPositionStyle = {
      position: 'fixed',
      top: `${finalTop}px`,
      zIndex,
      // 中文说明：子菜单第一次出现时先隐藏，等我们算出“真实尺寸”的定位后再显示，避免先左后右闪跳
      visibility: 'visible',
    };

    /**
     * 关键修复：当子菜单在左侧时，使用 right 定位而不是 left 定位。
     * 
     * 原因：
     * - 子菜单初次渲染时宽度是估算的（默认 240px），如果实际宽度只有 100px：
     * - 用 left 定位：left = anchor - 240。实际渲染后右边缘离 anchor 有 140px 空隙（表现为“跑很远”）。
     * - 用 right 定位：right = viewport - anchor。右边缘固定贴着 anchor，宽度变化只向左延伸，无空隙。
     */
    if (placeLeft) {
      // 放左侧：使用 right 定位
      // 计算 anchorLeft 距离视口右侧的距离：viewportWidth - anchorLeft
      // 子菜单右边缘应该在 anchorLeft - gap
      // 所以 style.right = viewportWidth - (anchorLeft - gap)
      const rightDist = viewportWidth - (anchorLeft - gap);
      style.right = `${rightDist}px`;
      style.left = 'auto'; // 清除 left
      
      // 防止向左延伸超出视口左边界：设置 max-width
      // 剩余可用空间 = anchorLeft - gap - padding
      const maxAvailableWidth = anchorLeft - gap - padding;
      style.maxWidth = `${maxAvailableWidth}px`;
    } else {
      // 放右侧：使用 left 定位
      // 保持之前的逻辑，clamp 确保不超右边界
      const finalLeft = clamp(idealRight, padding, maxLeft);
      style.left = `${finalLeft}px`;
      style.right = 'auto'; // 清除 right
    }

    submenuPosition.value = style;
  };

  /**
   * 展开指定选项的子菜单。调用方必须明确提供触发元素，焦点变化本身不能隐式展开。
   */
  const openSubmenu = async (
    option: CustomSelectOption<Value>,
    parentElement: EventTarget | null,
  ) => {
    // 清除任何待关闭的定时器
    clearSubmenuCloseTimer();
    
    // 处理子菜单
    if (option.children && option.children.length > 0) {
      if (!(parentElement instanceof globalThis.HTMLElement)) {
        hoveredOptionWithChildren.value = null;
        return;
      }

      // 如果悬停的是新的有子菜单的选项，立即切换
      hoveredOptionWithChildren.value = option;

      /**
       * 关键修复：不要在子菜单尚未渲染完成时“先算一次默认尺寸的位置”。
       *
       * 中文说明：
       * - 之前这里会先用默认 submenuWidth=240 计算一次位置；
       * - nextTick 后拿到真实宽度又算一次，导致靠近右侧时出现“先左后右”的闪跳。
       * - 这里改为：先把子菜单隐藏，等 nextTick+rAF 后拿到真实尺寸，再计算一次并显示。
       */
      submenuPosition.value = {
        position: 'fixed',
        top: '0px',
        left: '0px',
        visibility: 'hidden',
        // 先给一个合理的层级（避免闪现到错误层级），最终会在 calculateSubmenuPosition 里再算一次
        zIndex: resolveSubmenuZIndex(parentElement),
      };

      await nextTick();
      if (positionAnimationFrame !== null) cancelAnimationFrame(positionAnimationFrame);
      positionAnimationFrame = requestAnimationFrame(() => {
        calculateSubmenuPosition(parentElement);
        positionAnimationFrame = null;
      });
    } else {
      // 如果悬停的选项没有子菜单，立即关闭之前的子菜单
      hoveredOptionWithChildren.value = null;
    }
  };

  const handleOptionHover = (option: CustomSelectOption<Value>, event: MouseEvent) => {
    openSubmenu(option, event.currentTarget);
  };

  /**
   * 处理主菜单离开
   */
  const handleMainMenuLeave = () => {
    // 鼠标离开主菜单时，延迟关闭子菜单
    // 给用户时间移动到子菜单
    submenuCloseTimer = setTimeout(() => {
      hoveredOptionWithChildren.value = null;
    }, 200); // 200ms 延迟
  };

  /**
   * 保持子菜单打开
   */
  const keepSubmenuOpen = () => {
    // 鼠标进入子菜单时，清除关闭定时器
    clearSubmenuCloseTimer();
  };

  /**
   * 关闭子菜单
   */
  const closeSubmenu = () => {
    // 鼠标离开子菜单，立即关闭
    hoveredOptionWithChildren.value = null;
    clearSubmenuCloseTimer();
  };

  /**
   * 清除关闭定时器
   */
  const clearSubmenuCloseTimer = () => {
    if (submenuCloseTimer) {
      clearTimeout(submenuCloseTimer);
      submenuCloseTimer = null;
    }
  };

  /**
   * 强制关闭子菜单（用于选择选项或关闭主菜单时）
   */
  const forceCloseSubmenu = () => {
    hoveredOptionWithChildren.value = null;
    clearSubmenuCloseTimer();
  };

  onBeforeUnmount(() => {
    clearSubmenuCloseTimer();
    if (positionAnimationFrame !== null) cancelAnimationFrame(positionAnimationFrame);
  });

  return {
    hoveredOptionWithChildren,
    submenuPosition,
    openSubmenu,
    handleOptionHover,
    handleMainMenuLeave,
    keepSubmenuOpen,
    closeSubmenu,
    forceCloseSubmenu,
  };
}
