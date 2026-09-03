import { watch } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useWorkspaceSelectionStore } from '@/domains/workspace/store/WorkspaceSelectionStore';
import { getPresentableDocumentSelectionId } from '../functions/documentSelectionPresentation';

/**
 * 同步左侧侧边栏整体显隐与侧栏 selection 的“可见表达”。
 *
 * 中文说明：
 * - 当前打开文档属于 layout/document runtime，右侧 pane 收起不等于关闭文档；
 * - 侧边栏 selection 只是左侧树里“当前高亮 tab/行”的 UI 表达；
 * - 所以它只跟“当前文档是否可见”绑定，不跟左侧栏自身显隐绑定；
 * - 当前文档在右侧文档 pane 中被收起时清掉 selection，重新展开时恢复。
 */
export function useSidebarSelectionVisibility(): void {
  const layoutStore = useLayoutStore();
  const selectionStore = useWorkspaceSelectionStore();

  watch(
    () => ({
      sceneKind: layoutStore.state.scene.kind,
      activeDocumentId: layoutStore.state.activeDocument?.id ?? null,
      documentPanePlacement: layoutStore.state.documentPane.placement,
      documentPaneVisible: layoutStore.state.documentPane.visible,
    }),
    () => {
      const presentableDocumentId = getPresentableDocumentSelectionId(layoutStore.state);
      if (!presentableDocumentId) {
        selectionStore.clearSelection();
        return;
      }

      selectionStore.selectSingle(presentableDocumentId);
    }
  );
}
