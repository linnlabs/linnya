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

export const WINDOWS_HEADER_CONTROLS = {
  buttonCount: 3,
  buttonWidth: 46,
} as const;

export interface HeaderPaneGeometryInput {
  isMac: boolean;
  isWindowMaximized: boolean;
  sidebarOccupiedWidth: number;
  rightPaneWidth: number;
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

export function computeHeaderLeftChromeWidth(input: Pick<HeaderPaneGeometryInput, 'isMac' | 'isWindowMaximized'>): number {
  const nativeWindowInset = input.isMac && !input.isWindowMaximized
    ? HEADER_LEFT_NATIVE_INSET.macWindowed
    : HEADER_LEFT_NATIVE_INSET.default;

  return (
    nativeWindowInset
    + HEADER_LEFT_ACTIONS.buttonCount * HEADER_LEFT_ACTIONS.buttonSize
    + (HEADER_LEFT_ACTIONS.buttonCount - 1) * HEADER_LEFT_ACTIONS.buttonGap
    + HEADER_LEFT_ACTIONS.paneGap
  );
}

export function computeHeaderPaneGeometry(input: HeaderPaneGeometryInput): HeaderPaneGeometry {
  const windowsControlWidth = computeWindowsControlWidth(input.isMac);
  const leftChromeWidth = computeHeaderLeftChromeWidth(input);
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
