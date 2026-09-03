import type { LayoutState } from '../definitions/layoutState';

/**
 * 计算左侧文件树是否应该展示当前文档的选中态。
 *
 * 中文说明：文件树 selection 是“当前可见文档”的视觉表达，不是文档 runtime。
 * 当前文档在主区时应保持高亮；当前文档在右侧文档 pane 且该 pane 被收起时，
 * 文档仍然打开，但左侧 tab 不应继续显示选中态。
 */
export function getPresentableDocumentSelectionId(state: LayoutState): string | null {
  if (state.scene.kind !== 'workspace') {
    return null;
  }

  if (!state.activeDocument) {
    return null;
  }

  const isDocumentVisible =
    state.documentPane.placement === 'main-pane'
    || state.documentPane.visible;

  return isDocumentVisible ? state.activeDocument.id : null;
}
