/**
 * @file useFixedDropdownPosition.ts
 * @description 侧边栏 fixed 下拉菜单定位能力
 *
 * 中文说明：
 * - 侧边栏内的项目、文件节点都会把菜单 Teleport 到 body，并用 fixed 定位；
 * - 定位规则如果散落在各组件里，后续很容易出现某个菜单边界修了、另一个没修的分叉；
 * - 这里仅收敛“UI 定位规则”，不承载项目/文件的业务动作。
 */

import { nextTick, ref, type CSSProperties } from 'vue';

type DropdownAlign = 'start' | 'end';

interface FixedDropdownPositionOptions {
  align?: DropdownAlign;
  matchTriggerWidth?: boolean;
  offset?: number;
  viewportGap?: number;
}

interface FixedDropdownPositionParams extends Required<FixedDropdownPositionOptions> {
  triggerRect: DOMRectReadOnly;
  dropdownRect: DOMRectReadOnly;
  viewportWidth: number;
  viewportHeight: number;
}

function computeInitialLeft(params: FixedDropdownPositionParams): number {
  const dropdownWidth = params.matchTriggerWidth ? params.triggerRect.width : params.dropdownRect.width;

  if (params.align === 'end') {
    return params.triggerRect.right - dropdownWidth;
  }

  return params.triggerRect.left;
}

function computeFixedDropdownPosition(params: FixedDropdownPositionParams): CSSProperties {
  const { dropdownRect, offset, triggerRect, viewportGap, viewportHeight, viewportWidth } = params;
  const dropdownWidth = params.matchTriggerWidth ? triggerRect.width : dropdownRect.width;
  let top = triggerRect.bottom + offset;
  let left = computeInitialLeft(params);

  if (left + dropdownWidth > viewportWidth - viewportGap) {
    left = triggerRect.right - dropdownWidth;
  }

  if (left < viewportGap) {
    left = viewportGap;
  }

  if (top + dropdownRect.height > viewportHeight - viewportGap) {
    top = triggerRect.top - dropdownRect.height - offset;
  }

  if (top < viewportGap) {
    top = viewportGap;
  }

  const style: CSSProperties = {
    top: `${top}px`,
    left: `${left}px`,
  };

  if (params.matchTriggerWidth) {
    style.width = `${triggerRect.width}px`;
  }

  return style;
}

export function useFixedDropdownPosition(options: FixedDropdownPositionOptions = {}) {
  const align = options.align ?? 'start';
  const matchTriggerWidth = options.matchTriggerWidth ?? false;
  const offset = options.offset ?? 4;
  const viewportGap = options.viewportGap ?? 8;
  const dropdownRef = ref<HTMLElement | null>(null);
  const dropdownStyle = ref<CSSProperties>({
    top: '0px',
    left: '0px',
  });

  function positionDropdown(triggerEl: HTMLElement | null | undefined): void {
    const dropdownEl = dropdownRef.value;
    if (!triggerEl || !dropdownEl) return;

    dropdownStyle.value = computeFixedDropdownPosition({
      align,
      dropdownRect: dropdownEl.getBoundingClientRect(),
      matchTriggerWidth,
      offset,
      triggerRect: triggerEl.getBoundingClientRect(),
      viewportGap,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    });
  }

  async function positionDropdownAfterRender(triggerEl: HTMLElement | null | undefined): Promise<void> {
    await nextTick();
    positionDropdown(triggerEl);
  }

  return {
    dropdownRef,
    dropdownStyle,
    positionDropdown,
    positionDropdownAfterRender,
  };
}
