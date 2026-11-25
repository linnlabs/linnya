import type { DropdownMotionDirection } from '../definitions/dropdownPanel';

export interface FixedPanelPositionInput {
  readonly anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** 面板与触发器左沿对齐（start）或右沿对齐（end）。 */
  readonly align?: 'start' | 'end';
}

export interface FixedPanelPosition {
  readonly top: number;
  readonly left: number;
  readonly direction: DropdownMotionDirection;
}

const ANCHOR_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * 挂在 body 上的面板的视口坐标：默认放在触发器下方，下方放不下且上方更宽裕时翻到上方，
 * 横向收进视口。所有脱离滚动容器的面板共用这一份规则。
 */
export function resolveFixedPanelPosition(input: FixedPanelPositionInput): FixedPanelPosition {
  const { anchor, panelWidth, panelHeight, viewportWidth, viewportHeight } = input;
  const spaceBelow = viewportHeight - anchor.bottom;
  const opensUp = spaceBelow < panelHeight + VIEWPORT_MARGIN && anchor.top > spaceBelow;
  const top = opensUp
    ? anchor.top - panelHeight - ANCHOR_GAP
    : Math.min(anchor.bottom + ANCHOR_GAP, viewportHeight - panelHeight - VIEWPORT_MARGIN);
  const left = Math.min(
    input.align === 'end' ? anchor.right - panelWidth : anchor.left,
    viewportWidth - panelWidth - VIEWPORT_MARGIN,
  );
  return {
    top: Math.max(VIEWPORT_MARGIN, top),
    left: Math.max(VIEWPORT_MARGIN, left),
    direction: opensUp ? 'up' : 'down',
  };
}
