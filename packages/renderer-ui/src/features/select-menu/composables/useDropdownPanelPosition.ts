import { computed, ref, unref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { DropdownPanelPositionStyle } from '../definitions/selectMenu';
import { rendererUiOverlayLayer } from '../../overlays';
import { useAnchoredPosition } from '../../anchored-position';

interface UseDropdownPanelPositionOptions {
  isPortalMode: Readonly<Ref<boolean>>;
  isOpen: Readonly<Ref<boolean>>;
  selectRef: Ref<HTMLElement | null>;
  optionsRef: Ref<HTMLElement | null>;
  minWidth: Readonly<Ref<string>>;
  optionsMaxHeight: Readonly<Ref<string>>;
  optionsOverflow: Readonly<Ref<string>>;
}

interface UseDropdownPanelPositionResult {
  optionsPanelStyle: ComputedRef<DropdownPanelPositionStyle>;
}

/** Portal 面板与触发器之间的距离；下拉框面板一直比普通弹层贴得更近。 */
const PORTAL_PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** 只认像素值；百分比等相对写法在 Portal 里没有参照，按 0 处理（即与触发器同宽）。 */
function readPixelWidth(value: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? Number(match[1]) : 0;
}

/** 主菜单面板定位：普通模式留在组件内，Portal 模式由锚定定位贴着触发器摆放。 */
export function useDropdownPanelPosition({
  isPortalMode,
  isOpen,
  selectRef,
  optionsRef,
  minWidth,
  optionsMaxHeight,
  optionsOverflow,
}: UseDropdownPanelPositionOptions): UseDropdownPanelPositionResult {
  const portalOpen = computed(() => unref(isOpen) && unref(isPortalMode));
  const panelWidth = ref(0);
  const anchored = useAnchoredPosition({
    anchor: selectRef,
    floating: optionsRef,
    open: portalOpen,
    placement: { side: 'bottom', align: 'start', gap: PORTAL_PANEL_GAP, viewportMargin: VIEWPORT_MARGIN },
  });

  // 宽度要在面板渲染前定下来：定位按渲染后的布局宽度算，左右收边才对。
  watch(portalOpen, (open) => {
    const trigger = unref(selectRef);
    if (!open || !trigger) return;
    // Portal 面板默认与触发器同宽；以像素给出的 minWidth 可以撑宽，但不超过视口。
    panelWidth.value = Math.min(
      Math.max(trigger.getBoundingClientRect().width, readPixelWidth(unref(minWidth))),
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
  }, { immediate: true });

  const optionsPanelStyle = computed<DropdownPanelPositionStyle>(() => {
    const sizeOverrides = {
      ...(unref(optionsMaxHeight) ? { maxHeight: unref(optionsMaxHeight) } : {}),
      ...(unref(optionsOverflow) ? { overflow: unref(optionsOverflow) } : {}),
    };
    if (!unref(isPortalMode)) return { minWidth: unref(minWidth), ...sizeOverrides };
    return {
      ...anchored.style.value,
      width: `${panelWidth.value}px`,
      zIndex: rendererUiOverlayLayer('portalMenu'),
      ...sizeOverrides,
    };
  });

  return { optionsPanelStyle };
}
