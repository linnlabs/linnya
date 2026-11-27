import type { Placement } from '@floating-ui/dom';
import type { DropdownMotionDirection } from '../../select-menu/definitions/dropdownPanel';
import type { AnchoredAlign, AnchoredSide } from '../definitions/anchoredPosition';

export function toFloatingPlacement(side: AnchoredSide, align: AnchoredAlign): Placement {
  return align === 'center' ? side : `${side}-${align}`;
}

function readSide(value: string | undefined): AnchoredSide {
  switch (value) {
    case 'top':
    case 'bottom':
    case 'left':
    case 'right':
      return value;
    default:
      throw new Error(`Floating UI 返回了无法识别的 placement 方向：${String(value)}`);
  }
}

export function fromFloatingPlacement(placement: Placement): { side: AnchoredSide; align: AnchoredAlign } {
  const [side, alignment] = placement.split('-');
  return {
    side: readSide(side),
    align: alignment === 'start' || alignment === 'end' ? alignment : 'center',
  };
}

/** 下拉类浮层的入场方向：落在锚点上方时从下往上展开，其余都按向下展开。 */
export function anchoredMotionDirection(side: AnchoredSide): DropdownMotionDirection {
  return side === 'top' ? 'up' : 'down';
}

/** 右键菜单等以一个点为锚：零尺寸矩形，浮层从这个点展开。 */
export function createPointAnchor(clientX: number, clientY: number): { getBoundingClientRect(): DOMRect } {
  return { getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0) };
}
