import type { LayoutState } from '../definitions/layoutState';

export type WorkspacePaneNavigationPlacement = 'main-pane' | 'right-pane';

export interface WorkspacePaneNavigationPlan {
  placement: WorkspacePaneNavigationPlacement;
  closeSecondaryPane: boolean;
}

/**
 * 中文说明：
 * - 这个函数只回答“点击文档后文档应该去哪里”，不负责保存、加载或改 store；
 * - 同 scope 内保持“点哪哪出/换”，跨 scope 时关闭副栏，避免两个项目上下文并排展示。
 */
export function resolveDocumentNavigationPlan(
  state: LayoutState,
  isSameWorkspaceScope: boolean,
): WorkspacePaneNavigationPlan {
  if (!isSameWorkspaceScope) {
    return {
      placement: 'main-pane',
      closeSecondaryPane: true,
    };
  }

  if (state.layoutMode === 'chat-centric') {
    return {
      placement: 'right-pane',
      closeSecondaryPane: false,
    };
  }

  return {
    placement: 'main-pane',
    closeSecondaryPane: false,
  };
}

/**
 * 中文说明：
 * - 对话点击和文档点击使用对称规则，避免 conversation domain 自己猜 layout 细节；
 * - 右 pane 是否关闭由 scope 边界决定，而不是由具体 UI 组件临时处理。
 */
export function resolveConversationNavigationPlan(
  state: LayoutState,
  isSameWorkspaceScope: boolean,
): WorkspacePaneNavigationPlan {
  if (!isSameWorkspaceScope) {
    return {
      placement: 'main-pane',
      closeSecondaryPane: true,
    };
  }

  if (
    state.layoutMode === 'editor-centric'
    && (state.activeDocument !== null || state.documentPane.emptyStateVisible)
  ) {
    return {
      placement: 'right-pane',
      closeSecondaryPane: false,
    };
  }

  return {
    placement: 'main-pane',
    closeSecondaryPane: false,
  };
}
