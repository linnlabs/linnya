/**
 * TreeItem 拖放逻辑 Composable
 * 
 * 职责：
 * - 管理单个树项目的拖放状态
 * - 处理拖放事件（dragstart, dragend, dragover, dragleave, drop）
 * - 与 UI Store 同步拖放高亮状态
 * - 执行文件/文件夹移动操作
 */

import { ref, computed, inject } from 'vue';
import { useUIStore } from '../../../../../shared/stores/ui';
import { useWorkspaceTreeStore } from '../../../store';
import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceOperationFailure } from '@/domains/workspace/functions/resolveWorkspaceOperationFailure';

export function useTreeItemDragDrop(props, showError) {
  const uiStore = useUIStore();
  const treeStore = useWorkspaceTreeStore();
  const { workspaceMessage } = useWorkspaceLocalization();
  
  // 从父组件注入的重置函数
  const resetDragStates = inject('resetDragStates', null);
  
  // 本地拖放状态
  const isDragging = ref(false);
  
  // 计算属性：当前项目是否被拖放悬停
  const isDragOver = computed(() => uiStore.draggedOverItemId === props.node.id);
  
  /**
   * 拖动开始
   */
  const handleDragStart = (event) => {
    if (props.isRenaming.value || props.node.isVirtual) {
      event.preventDefault();
      return;
    }
    
    isDragging.value = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tree-item-id', props.node.id);
    event.dataTransfer.setData('application/x-tree-item-type', props.node.type);
    console.log(`[TreeItem] 开始拖动: ${props.node.name} (ID: ${props.node.id})`);
  };
  
  /**
   * 拖动结束
   * 关键：无论拖放是否成功，这个事件都会触发
   */
  const handleDragEnd = () => {
    isDragging.value = false;
    
    // 全局重置拖放悬停状态
    uiStore.setDraggedOverItemId(null);
    
    // 重置父组件（Sidebar）的拖放状态
    if (resetDragStates) {
      resetDragStates();
    }
    
    console.log(`[TreeItem] 拖动结束，已重置所有拖放状态`);
  };
  
  /**
   * 拖动悬停
   * 核心逻辑：
   * - 文件：不处理，让事件冒泡到父文件夹
   * - 文件夹：设置高亮，阻止冒泡
   */
  const handleDragOver = (event) => {
    // 只允许拖放到文件夹上
    if (props.node.type !== 'folder' || props.node.isVirtual) {
      // 如果是文件，不处理，让事件冒泡到父文件夹
      return;
    }
    
    // 防止拖动自己
    const draggedId = event.dataTransfer.getData('application/x-tree-item-id');
    if (draggedId === props.node.id) {
      return;
    }
    
    // 接受拖放：设置全局高亮状态
    event.dataTransfer.dropEffect = 'move';
    uiStore.setDraggedOverItemId(props.node.id);
    
    // 阻止事件继续冒泡到父级（避免同时高亮父文件夹）
    event.stopPropagation();
  };
  
  /**
   * 拖动离开
   */
  const handleDragLeave = (event) => {
    // 确保只在真正离开元素时取消高亮
    if (!event.currentTarget.contains(event.relatedTarget)) {
      uiStore.setDraggedOverItemId(null);
    }
  };
  
  /**
   * 放下
   * 核心逻辑：
   * - 文件：不处理，让事件冒泡到父文件夹
   * - 文件夹：立即阻止冒泡，清除高亮，执行移动
   */
  const handleDrop = async (event) => {
    // 只允许文件夹处理 drop 事件
    if (props.node.type !== 'folder' || props.node.isVirtual) {
      // 如果是文件，不处理，让事件冒泡到父文件夹
      return;
    }
    
    // 关键：立即阻止事件冒泡，防止上层文件夹重复处理
    event.stopPropagation();
    
    // 立即重置拖放高亮状态
    uiStore.setDraggedOverItemId(null);
    
    const draggedId = event.dataTransfer.getData('application/x-tree-item-id');
    const draggedType = event.dataTransfer.getData('application/x-tree-item-type');
    
    if (!draggedId) {
      console.warn('[TreeItem] 没有拖动节点 ID 数据');
      return;
    }
    
    // 防止拖动到自己
    if (draggedId === props.node.id) {
      console.log('[TreeItem] 不能将项目移动到自己');
      return;
    }
    
    // 防止将文件夹拖动到自己的子文件夹中
    if (draggedType === 'folder') {
      // 检查目标(props.node.id)是否是被拖动项(draggedId)的后代
      const isMovingIntoDescendant = treeStore.isDescendant(draggedId, props.node.id);
      if (isMovingIntoDescendant) {
        showError(workspaceMessage('workspace.sidebar.node.moveIntoDescendantBlocked'));
        return;
      }
    }
    
    console.log(`[TreeItem] 拖放: ${draggedId} -> ${props.node.id}`);
    
    try {
      // 1. 先找到被拖动节点，记录它的原父节点ID
      const draggedNode = treeStore.findNodeById(draggedId);
      console.log(`[TreeItem] 找到被拖动节点:`, draggedNode);
      
      if (!draggedNode) {
        throw new Error(`拖动节点 ${draggedId} 在前端树中找不到`);
      }
      
      const oldParentId = draggedNode.parentId;
      console.log(`[TreeItem] 原父节点ID: ${oldParentId}, 新父节点ID: ${props.node.id}`);
      
      // 2. 执行移动操作
      console.log(`[TreeItem] 准备调用后端 move-node...`);
      const result = await workspaceGateway['move-node']({
        nodeId: draggedId,
        newParentId: props.node.id,
      });
      console.log(`[TreeItem] 后端返回结果:`, result);

      if (result.success) {
        // 中文说明：提交后的树刷新由 workspace.node.moved mutation 统一驱动，
        // 这里再次刷新会让一次拖拽产生两轮数据库加载。
        console.log('[TreeItem] 移动成功，等待 mutation 刷新文件树');
      } else {
        showError(resolveWorkspaceOperationFailure(
          result,
          workspaceMessage,
          'workspace.sidebar.node.moveFailed'
        ));
      }
    } catch (error) {
      console.error(`[TreeItem] 移动失败:`, error);
      showError(workspaceMessage('workspace.sidebar.node.moveFailed'));
    }
  };
  
  return {
    isDragging,
    isDragOver,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
