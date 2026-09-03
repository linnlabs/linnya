export type WorkspacePaneContent = 'conversation' | 'document';

export interface WorkspaceSplitState {
  /** 当前布局期望的右侧 pane 宽度；拖拽或交换位置时更新，实际宽度还要结合当前窗口计算。 */
  preferredRightPaneWidth: number;
}

export interface WorkspacePaneGeometryInput {
  availableWidth: number;
  preferredRightPaneWidth: number;
  mainPaneContent: WorkspacePaneContent;
  rightPaneContent: WorkspacePaneContent;
  rightPaneVisible: boolean;
}

export interface WorkspacePaneGeometry {
  availableWidth: number;
  mainPaneMinWidth: number;
  rightPaneMinWidth: number;
  rightPaneMaxWidth: number;
  /** 右侧内容保持挂载时使用的宽度。 */
  rightPaneWidth: number;
  /** 右侧 pane 真正参与当前布局的宽度；响应式收起时为 0。 */
  rightPaneOccupiedWidth: number;
  canOccupyRightPane: boolean;
}

export const DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH = 480;

export const WORKSPACE_PANE_MIN_WIDTHS = {
  conversation: 360,
  document: 480,
} as const satisfies Readonly<Record<WorkspacePaneContent, number>>;
