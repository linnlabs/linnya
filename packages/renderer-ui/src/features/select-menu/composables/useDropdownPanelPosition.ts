import { computed, nextTick, ref, unref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { DropdownPanelPositionStyle } from '../definitions/selectMenu';
import { rendererUiOverlayLayer } from '../../overlays';

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

/** 主菜单面板定位：普通模式留在组件内，Portal 模式按视口计算 fixed 坐标。 */
export function useDropdownPanelPosition({
  isPortalMode,
  isOpen,
  selectRef,
  optionsRef,
  minWidth,
  optionsMaxHeight,
  optionsOverflow,
}: UseDropdownPanelPositionOptions): UseDropdownPanelPositionResult {
  const portalPosition = ref<DropdownPanelPositionStyle>({
    top: '0px',
    left: '0px',
    width: '0px',
    zIndex: rendererUiOverlayLayer('portalMenu'),
  });

  const optionsPanelStyle = computed<DropdownPanelPositionStyle>(() => {
    const sizeOverrides = {
      ...(unref(optionsMaxHeight) ? { maxHeight: unref(optionsMaxHeight) } : {}),
      ...(unref(optionsOverflow) ? { overflow: unref(optionsOverflow) } : {}),
    };
    if (!unref(isPortalMode)) return { minWidth: unref(minWidth), ...sizeOverrides };
    return { ...portalPosition.value, ...sizeOverrides };
  });

  function updatePortalPosition() {
    const trigger = unref(selectRef);
    if (!unref(isPortalMode) || !(trigger instanceof HTMLElement)) return;

    const triggerRect = trigger.getBoundingClientRect();
    const panel = unref(optionsRef);
    const measuredHeight = panel instanceof HTMLElement ? panel.getBoundingClientRect().height : 0;
    const panelHeight = measuredHeight > 0 ? measuredHeight : 240;
    const panelWidth = triggerRect.width;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    let top = triggerRect.bottom + 4;
    if (spaceBelow < panelHeight + 8 && spaceAbove > spaceBelow) {
      top = Math.max(8, triggerRect.top - panelHeight - 4);
    } else if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - panelHeight - 8);
    }

    let left = triggerRect.left;
    if (left + panelWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - panelWidth - 8);
    }

    portalPosition.value = {
      top: `${top}px`,
      left: `${left}px`,
      width: `${panelWidth}px`,
      zIndex: rendererUiOverlayLayer('portalMenu'),
    };
  }

  watch(
    [() => unref(isOpen), () => unref(isPortalMode)],
    ([open, portal]) => {
      if (!open || !portal) return;
      void nextTick(() => {
        updatePortalPosition();
        void nextTick(updatePortalPosition);
      });
    },
  );

  return { optionsPanelStyle };
}
