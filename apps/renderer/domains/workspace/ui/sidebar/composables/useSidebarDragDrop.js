/**
 * Sidebar 根目录拖放逻辑 Composable
 * 
 * 职责：
 * - 管理根目录的拖放状态
 * - 处理拖放到根目录的事件
 * - 执行移动到根目录的操作
 */

import { ref, watch } from 'vue';
import { useUIStore } from '../../../../../shared/stores/ui';
import { useWorkspaceTreeStore } from '../../../store';
import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceOperationFailure } from '@/domains/workspace/functions/resolveWorkspaceOperationFailure';

export function useSidebarDragDrop(showError) {
  const uiStore = useUIStore();
  const treeStore = useWorkspaceTreeStore();
  const { workspaceMessage } = useWorkspaceLocalization();
  
  // 根目录拖放状态
  const isDragOverRoot = ref(false);
  
  // 监听：当有子项被悬停时，自动清除根目录高亮
  watch(() => uiStore.draggedOverItemId, (newValue) => {
    if (newValue) {
      // 有子项被悬停，清除根目录高亮
      isDragOverRoot.value = false;
    }
  });
  
  /**
   * 重置所有拖放状态
   */
  const resetDragStates = () => {
    isDragOverRoot.value = false;
  };
  
  /**
   * 拖动悬停在根目录
   * 只有在没有任何 TreeItem 被悬停时才高亮根目录
   */
  const handleRootDragOver = (event) => {
    // 如果正在某个 TreeItem 上方拖拽，则不高亮根目录
    if (uiStore.draggedOverItemId) {
      isDragOverRoot.value = false;
      return;
    }
    
    // 检查是否是从文件树拖动的项目
    const hasTreeItem = event.dataTransfer.types.includes('application/x-tree-item-id');
    if (hasTreeItem) {
      event.dataTransfer.dropEffect = 'move';
      isDragOverRoot.value = true;
    }
  };
  
  /**
   * 拖动离开根目录
   */
  const handleRootDragLeave = (event) => {
    // 确保只在真正离开区域时取消高亮
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      isDragOverRoot.value = false;
    }
  };
  
  /**
   * 放下到根目录
   */
  const handleRootDrop = async (event) => {
    isDragOverRoot.value = false;
    
    const draggedId = event.dataTransfer.getData('application/x-tree-item-id');
    
    if (!draggedId) {
      console.warn('[Sidebar] 没有拖动节点 ID 数据');
      return;
    }
    
    const draggedNode = treeStore.findNodeById(draggedId);
    const oldParentId = draggedNode ? draggedNode.parentId : null;

    if (draggedNode && !oldParentId) {
      console.log('[Sidebar] 节点已在根目录，无需移动');
      return;
    }
    
    console.log(`[Sidebar] 拖放到根目录: ${draggedId}`);
    
    try {
      const result = await workspaceGateway['move-node']({
        nodeId: draggedId,
        newParentId: null,
      });

      if (result.success) {
        // 中文说明：mutation bus 是节点写入后的唯一投影刷新入口。
        console.log('[Sidebar] 成功移动到根目录，等待 mutation 刷新文件树');
      } else {
        console.error('[Sidebar] 移动项目到根目录失败:', result.error);
        showError(resolveWorkspaceOperationFailure(
          result,
          workspaceMessage,
          'workspace.sidebar.node.moveFailed'
        ));
      }
    } catch (error) {
      console.error('[Sidebar] 移动项目到根目录错误:', error);
      showError(workspaceMessage('workspace.sidebar.node.moveFailed'));
    } finally {
      // 任何情况下，结束根目录高亮
      isDragOverRoot.value = false;
    }
  };
  
  return {
    isDragOverRoot,
    resetDragStates,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
