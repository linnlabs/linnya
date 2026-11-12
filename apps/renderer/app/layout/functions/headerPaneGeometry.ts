export const HEADER_LEFT_NATIVE_INSET = {
  macWindowed: 78,
  default: 6,
} as const;

export const HEADER_LEFT_ACTIONS = {
  buttonCount: 3,
  buttonSize: 24,
  buttonGap: 8,
  paneGap: 12,
} as const;

/** 侧栏分隔线拖拽热区向左伸出的宽度（PaneDivider.css 中 8px 热区居中）；左侧按钮不能伸进去。 */
export const HEADER_SIDEBAR_DIVIDER_CLEARANCE = 4;

export const WINDOWS_HEADER_CONTROLS = {
  buttonCount: 3,
  buttonWidth: 46,
} as const;

export interface HeaderPaneGeometryInput {
  isMac: boolean;
  isWindowMaximized: boolean;
  sidebarOccupiedWidth: number;
  rightPaneWidth: number;
  /** 设置按钮右侧更新入口的实际宽度；没有入口时为 0。 */
  updateEntryWidth?: number;
}

export interface HeaderPaneGeometry {
  mainPaneLeft: number;
  mainPaneRight: number;
  rightPaneRight: number;
  rightPaneWidth: number;
  trailingChromeWidth: number;
}

export function computeWindowsControlWidth(isMac: boolean): number {
  if (isMac) return 0;
  return WINDOWS_HEADER_CONTROLS.buttonCount * WINDOWS_HEADER_CONTROLS.buttonWidth;
}

type HeaderLeftInsetInput = Pick<HeaderPaneGeometryInput, 'isMac' | 'isWindowMaximized'>;

function computeHeaderLeftNativeInset(input: HeaderLeftInsetInput): number {
  return input.isMac && !input.isWindowMaximized
    ? HEADER_LEFT_NATIVE_INSET.macWindowed
    : HEADER_LEFT_NATIVE_INSET.default;
}

/** 更新入口的左边：紧跟在三个固定按钮之后，间距与按钮之间相同。 */
export function computeHeaderUpdateEntryStart(input: HeaderLeftInsetInput): number {
  return (
    computeHeaderLeftNativeInset(input)
    + HEADER_LEFT_ACTIONS.buttonCount * (HEADER_LEFT_ACTIONS.buttonSize + HEADER_LEFT_ACTIONS.buttonGap)
  );
}

/**
 * 侧栏展开时，更新入口只能用到分隔线热区之前的宽度；放不下完整按钮时由入口自己收成图标。
 * 侧栏收起时没有限制，返回 null，改由主 pane 左边界让开入口。
 */
export function computeHeaderUpdateEntryAvailableWidth(
  input: HeaderLeftInsetInput & Pick<HeaderPaneGeometryInput, 'sidebarOccupiedWidth'>,
): number | null {
  if (input.sidebarOccupiedWidth <= 0) return null;
  return input.sidebarOccupiedWidth - HEADER_SIDEBAR_DIVIDER_CLEARANCE - computeHeaderUpdateEntryStart(input);
}

export function computeHeaderLeftChromeWidth(
  input: HeaderLeftInsetInput & Pick<HeaderPaneGeometryInput, 'updateEntryWidth'>,
): number {
  const updateEntryWidth = input.updateEntryWidth ?? 0;
  return (
    computeHeaderLeftNativeInset(input)
    + HEADER_LEFT_ACTIONS.buttonCount * HEADER_LEFT_ACTIONS.buttonSize
    + (HEADER_LEFT_ACTIONS.buttonCount - 1) * HEADER_LEFT_ACTIONS.buttonGap
    + (updateEntryWidth > 0 ? HEADER_LEFT_ACTIONS.buttonGap + updateEntryWidth : 0)
    + HEADER_LEFT_ACTIONS.paneGap
  );
}

export function computeHeaderPaneGeometry(input: HeaderPaneGeometryInput): HeaderPaneGeometry {
  const windowsControlWidth = computeWindowsControlWidth(input.isMac);
  // 侧栏展开时更新入口收在侧栏宽度内，不推动主 pane；收起时主 pane 要让开它。
  const leftChromeWidth = computeHeaderLeftChromeWidth({
    ...input,
    updateEntryWidth: input.sidebarOccupiedWidth > 0 ? 0 : input.updateEntryWidth,
  });
  const mainPaneLeft = Math.max(input.sidebarOccupiedWidth, leftChromeWidth);
  const hasVisibleRightPane = input.rightPaneWidth > 0;

  return {
    mainPaneLeft,
    mainPaneRight: input.rightPaneWidth + (hasVisibleRightPane ? 0 : windowsControlWidth),
    rightPaneRight: 0,
    rightPaneWidth: input.rightPaneWidth,
    trailingChromeWidth: windowsControlWidth,
  };
}
