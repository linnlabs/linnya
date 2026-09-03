/**
 * @file useAddToKnowledgeBase.ts
 * @description 统一管理“添加到知识库”弹窗与提交流程
 *
 * 中文说明：
 * - TreeItem 与 app 侧边栏组合面复用同一套状态与提交逻辑
 * - 避免在多个组件中重复实现 editor/kbStore/notification 调用
 */

import { ref } from 'vue';
import { useUIStore } from '../../../../../shared/stores/ui.js';
import { useNotificationStore } from '@/app/notification';
import { useKnowledgeBaseStore } from '../../../../knowledgebase/stores/knowledgeBase';
import { addCurrentDocumentToKb } from '../../../../knowledgebase/services/addCurrentDocumentToKb';
import { useKnowledgeBaseLocalization } from '../../../../knowledgebase/ui/useKnowledgeBaseLocalization';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';

/**
 * “添加到知识库”通用逻辑
 */
export function useAddToKnowledgeBase() {
  const uiStore = useUIStore();
  const notificationStore = useNotificationStore();
  const kbStore = useKnowledgeBaseStore();
  const { workspaceMessage } = useWorkspaceLocalization();
  const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

  const showAddToKbModal = ref(false);
  const targetDocumentName = ref(workspaceMessage('workspace.sidebar.node.untitledDocument'));

  /**
   * 打开弹窗并设置目标文档名
   */
  const openAddToKnowledgeBaseModal = (documentName: string | null | undefined) => {
    targetDocumentName.value = documentName?.trim() || workspaceMessage('workspace.sidebar.node.untitledDocument');
    showAddToKbModal.value = true;
  };

  /**
   * 关闭弹窗并清理状态
   */
  const closeAddToKnowledgeBaseModal = () => {
    showAddToKbModal.value = false;
    targetDocumentName.value = workspaceMessage('workspace.sidebar.node.untitledDocument');
  };

  /**
   * 确认添加到知识库
   */
  const handleAddToKbConfirm = async (kbId: string) => {
    showAddToKbModal.value = false;

    const editor = uiStore.getEditor();
    if (!editor) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.addToKnowledgeBaseEditorUnavailable'), 'error', 3000);
      targetDocumentName.value = workspaceMessage('workspace.sidebar.node.untitledDocument');
      return;
    }

    const result = await addCurrentDocumentToKb({
      targetKbId: kbId,
      documentName: targetDocumentName.value,
      editor,
      kbStore,
      message: knowledgeBaseMessage,
    });

    if (result.success) {
      notificationStore.show(
        workspaceMessage('workspace.sidebar.node.addToKnowledgeBaseSuccess', { fileName: result.fileName }),
        'success',
        3000
      );
    } else {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.addToKnowledgeBaseFailed'), 'error', 3000);
    }

    targetDocumentName.value = workspaceMessage('workspace.sidebar.node.untitledDocument');
  };

  return {
    showAddToKbModal,
    targetDocumentName,
    openAddToKnowledgeBaseModal,
    closeAddToKnowledgeBaseModal,
    handleAddToKbConfirm,
  };
}
