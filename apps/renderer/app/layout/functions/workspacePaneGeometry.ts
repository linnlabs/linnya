import {
  DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH,
  WORKSPACE_PANE_MIN_WIDTHS,
  type WorkspacePaneGeometry,
  type WorkspacePaneGeometryInput,
} from '../definitions/workspacePaneGeometry';
import type { LayoutState } from '../definitions/layoutState';

function normalizeWidth(width: number, fallback: number): number {
  if (!Number.isFinite(width)) return fallback;
  return Math.max(0, Math.round(width));
}

/**
 * 统一计算 workspace 主 pane 与右 pane 的几何。
 *
 * 右侧 pane 没有固定最大宽度；它的动态上限只用于给主 pane 留出最低可用空间。
 * 当窗口连两个最小宽度都放不下时，右侧 runtime 保持挂载但暂不占位，窗口恢复后自动出现。
 */
export function computeWorkspacePaneGeometry(
  input: WorkspacePaneGeometryInput,
): WorkspacePaneGeometry {
  const availableWidth = normalizeWidth(input.availableWidth, 0);
  const mainPaneMinWidth = WORKSPACE_PANE_MIN_WIDTHS[input.mainPaneContent];
  const rightPaneMinWidth = WORKSPACE_PANE_MIN_WIDTHS[input.rightPaneContent];
  const canOccupyRightPane = availableWidth >= mainPaneMinWidth + rightPaneMinWidth;
  const rightPaneMaxWidth = canOccupyRightPane
    ? availableWidth - mainPaneMinWidth
    : 0;
  const preferredRightPaneWidth = normalizeWidth(
    input.preferredRightPaneWidth,
    DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH,
  );
  const rightPaneWidth = canOccupyRightPane
    ? Math.min(
        rightPaneMaxWidth,
        Math.max(rightPaneMinWidth, preferredRightPaneWidth),
      )
    : rightPaneMinWidth;

  return {
    availableWidth,
    mainPaneMinWidth,
    rightPaneMinWidth,
    rightPaneMaxWidth,
    rightPaneWidth,
    rightPaneOccupiedWidth: input.rightPaneVisible && canOccupyRightPane
      ? rightPaneWidth
      : 0,
    canOccupyRightPane,
  };
}

/**
 * 从布局状态投影 workspace 的唯一 pane 几何输入。
 * Header、WorkspaceStage 和位置交换编排必须复用这条规则，不能分别猜测内容归属与显隐。
 */
export function computeWorkspacePaneGeometryFromLayoutState(
  state: LayoutState,
  availableWidth: number,
): WorkspacePaneGeometry {
  const hasWorkspaceFileSurface = (
    state.activeDocument !== null
    || state.documentPane.emptyStateVisible
  );
  const isConversationMain = state.layoutMode === 'chat-centric';
  const rightPaneVisible = hasWorkspaceFileSurface && (
    isConversationMain
      ? state.documentPane.visible
      : state.conversationPane.visible
  );

  return computeWorkspacePaneGeometry({
    availableWidth,
    preferredRightPaneWidth: state.workspaceSplit.preferredRightPaneWidth,
    mainPaneContent: isConversationMain ? 'conversation' : 'document',
    rightPaneContent: isConversationMain ? 'document' : 'conversation',
    rightPaneVisible,
  });
}

/**
 * 交换内容位置时，分割线也必须镜像过去，保证宽度跟随内容一起交换。
 * 例如主区 520px、右侧 880px，交换后新的右侧宽度应为 520px。
 */
export function computeWorkspacePanePlacementSwapPreferredWidth(
  state: LayoutState,
  availableWidth: number,
): number {
  const geometry = computeWorkspacePaneGeometryFromLayoutState(state, availableWidth);

  // 右侧未参与布局时没有两块可交换的实际宽度，保留当前偏好即可。
  if (geometry.rightPaneOccupiedWidth === 0) {
    return state.workspaceSplit.preferredRightPaneWidth;
  }

  return geometry.availableWidth - geometry.rightPaneOccupiedWidth;
}
