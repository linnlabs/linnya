/**
 * @file useContextMenu.js
 * @description 上下文菜单逻辑
 */

import { ref } from 'vue';
import { useWorkspaceSelectionStore } from '../../../store/index.js';
import { getWorkspaceNodeDeletionPort } from '@/shared/ports/workspaceNodeDeletionPort';
import {
  getWorkspaceNodeTransferPort,
  WorkspaceNodeTransferSaveError,
} from '@/shared/ports/workspaceNodeTransferPort';
import { confirm } from '../../../../../shared/composables/confirmDialog';
import {
  buildNodeContextMenuOptions,
  filterBatchUnsupportedNodeContextMenuActions,
  getCreateRequestTypeFromContextMenuAction,
  getNodeLocalFilePath,
  getTargetProjectIdFromContextMenuAction,
  isNodeContextMenuActionAllowed,
} from '../functions/nodeContextMenuModel';
import { getDocumentTypeByNodeType } from '@/app/plugins/registry';
import { useLocalization } from '@/app/localization';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceNodeDisplayName } from '../../../functions/resolveWorkspaceNodeDisplayName';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { getWorkspaceOperationFailure } from '../../../definitions/workspaceOperationError';
import { resolveWorkspaceOperationFailure } from '../../../functions/resolveWorkspaceOperationFailure';

function getMoveTargetProjects(projectsStore, item) {
  const sourceProjectId = item?.projectId ?? projectsStore.activeProjectId;
  return projectsStore.projects
    .filter((project) => project.id !== sourceProjectId)
    .map((project) => ({ id: project.id, name: project.name }));
}

export function isDocumentNode(item) {
  return Boolean(item && getDocumentTypeByNodeType(String(item.type)) && item.isVirtual !== true);
}

function getNodeDisplayName(item, workspaceMessage) {
  return resolveWorkspaceNodeDisplayName(item, workspaceMessage('workspace.sidebar.node.fallbackName'));
}

/**
 * 统一的节点菜单选项（右键菜单与 More 菜单共用）
 * 中文说明：
 * - 菜单由 node capability 生成，而不是在组件层按 isVirtual 粗暴屏蔽；
 * - 虚拟资源不会得到 rename/delete/duplicate 等真实节点动作。
 */
export function getNodeMenuOptions(item, presentationOptions = {}) {
  const enabledPluginsStore = useEnabledPluginsStore();
  const { workspaceMessage } = useWorkspaceLocalization();
  const { t } = useLocalization();
  const projectsStore = useWorkspaceProjectsStore();
  const options = buildNodeContextMenuOptions(item, {
    enabledPluginIds: enabledPluginsStore.enabledPluginIds,
    message: workspaceMessage,
    getDocumentTypeLabel: (documentType) => resolveDocumentTypeTextPresentation(documentType, t).label,
    hideKnowledgeBaseAction: presentationOptions.surface === 'batch-context',
    disableUnsupportedKnowledgeBaseAction: presentationOptions.surface !== 'batch-context',
    moveTargetProjects: getMoveTargetProjects(projectsStore, item),
  });
  return presentationOptions.batchSelection
    ? filterBatchUnsupportedNodeContextMenuActions(options)
    : options;
}

export function useContextMenu(treeStore, fileStore, notificationStore, options = {}) {
  const selectionStore = useWorkspaceSelectionStore();
  const projectsStore = useWorkspaceProjectsStore();
  const enabledPluginsStore = useEnabledPluginsStore();
  const { workspaceMessage } = useWorkspaceLocalization();
  const { t } = useLocalization();
  const {
    openAssetFilePreview,
    createNewFile,
    createNewFolder,
    onAddToKnowledgeBase,
  } = options;
  const nodeDeletion = getWorkspaceNodeDeletionPort();
  const nodeTransfer = getWorkspaceNodeTransferPort();
  const contextMenu = ref({ visible: false, x: 0, y: 0, item: null });

  /**
   * 显示上下文菜单
   */
  const handleContextMenuRequest = ({ event, item }) => {
    event.preventDefault();
    contextMenu.value = { item, x: event.clientX, y: event.clientY, visible: true };
  };

  const copyTextToClipboard = async (text, successMessage) => {
    if (!text) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.noCopyContent'), 'warning');
      return;
    }

    await navigator.clipboard.writeText(text);
    notificationStore.show(successMessage, 'success');
  };

  const previewNode = async (item) => {
    if (item.type === 'asset_file') {
      await openAssetFilePreview?.(item);
    }
  };

  const handleDuplicateItems = async (clickedNode) => {
    const selectedNodes = [...selectionStore.selectedNodeIds]
      .map(nodeId => treeStore.findNodeById(nodeId))
      .filter(node => node && isNodeContextMenuActionAllowed(node, 'duplicate', {
        enabledPluginIds: enabledPluginsStore.enabledPluginIds,
        message: workspaceMessage,
        getDocumentTypeLabel: (documentType) => resolveDocumentTypeTextPresentation(documentType, t).label,
      }));
    const nodesToDuplicate = selectedNodes.length > 1 && selectedNodes.some(node => node.id === clickedNode.id)
      ? selectedNodes
      : [clickedNode];
    const results = await Promise.allSettled(nodesToDuplicate.map(node => treeStore.duplicateNode(node.id)));
    const successCount = results.filter(result => result.status === 'fulfilled').length;
    const failCount = results.length - successCount;
    if (failCount === 0) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDuplicateSuccess', { count: successCount }), 'success');
    } else if (successCount > 0) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDuplicatePartial', { successCount, failCount }), 'warning');
    } else {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDuplicateFailed'), 'error');
    }
  };

  const createFileUnderNode = async (item, type) => {
    if (typeof createNewFile !== 'function') {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.createFileUnsupported'), 'warning');
      return;
    }
    await createNewFile({ type, parentId: item.id });
  };

  const showNodeInFolder = async (item) => {
    const filePath = getNodeLocalFilePath(item);
    if (!filePath) return;
    if (!window.electronAPI?.showItemInFolder) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.showInFolderUnsupported'), 'warning');
      return;
    }
    const result = await window.electronAPI.showItemInFolder(filePath);
    if (!result?.success) {
      throw new Error(result?.error || workspaceMessage('workspace.sidebar.node.showInFolderFailed'));
    }
  };

  /**
   * 处理菜单选择
   */
  const handleMenuSelect = async ({ action, item }) => {
    if (!item || !action) return;
    const targetProjectId = getTargetProjectIdFromContextMenuAction(action);

    if (!isNodeContextMenuActionAllowed(item, action, {
      enabledPluginIds: enabledPluginsStore.enabledPluginIds,
      message: workspaceMessage,
      getDocumentTypeLabel: (documentType) => resolveDocumentTypeTextPresentation(documentType, t).label,
      disableUnsupportedKnowledgeBaseAction: true,
      moveTargetProjects: getMoveTargetProjects(projectsStore, item),
    })) {
      notificationStore.show(workspaceMessage('workspace.sidebar.node.actionUnsupported'), 'warning');
      contextMenu.value.visible = false;
      return;
    }

    try {
      const createRequestType = getCreateRequestTypeFromContextMenuAction(action);
      if (createRequestType) {
        await createFileUnderNode(item, createRequestType);
      } else if (action === 'preview') {
        await previewNode(item);
      } else if (action === 'new-folder') {
        if (typeof createNewFolder === 'function') {
          await createNewFolder({ parentId: item.id });
        } else {
          notificationStore.show(workspaceMessage('workspace.sidebar.node.createFolderUnsupported'), 'warning');
        }
      } else if (action === 'rename') {
        treeStore.setRenameRequestNodeId(item.id);
      } else if (targetProjectId) {
        const targetProject = projectsStore.projects.find((project) => project.id === targetProjectId);
        const result = await nodeTransfer.transferNode({ nodeId: item.id, targetProjectId });
        notificationStore.show(workspaceMessage('workspace.sidebar.node.transferSuccess', {
          nodeName: getNodeDisplayName(item, workspaceMessage),
          projectName: targetProject?.name ?? result.targetProjectId,
        }), 'success');
      } else if (action === 'delete') {
        await handleDeleteItems(item);
      } else if (action === 'duplicate') {
        const selectedIds = selectionStore.selectedNodeIds;
        if (selectedIds.size > 1 && selectedIds.has(item.id)) {
          await handleDuplicateItems(item);
        } else {
          await treeStore.duplicateNode(item.id);
          notificationStore.show(workspaceMessage('workspace.sidebar.node.duplicated', { nodeName: getNodeDisplayName(item, workspaceMessage) }), 'success');
        }
      } else if (action === 'add-to-kb') {
        if (typeof onAddToKnowledgeBase === 'function') {
          onAddToKnowledgeBase(item);
        } else {
          notificationStore.show(workspaceMessage('workspace.sidebar.node.addToKnowledgeBaseUnsupported'), 'warning');
        }
      } else if (action === 'copy-relative-path') {
        await copyTextToClipboard(item.path, workspaceMessage('workspace.sidebar.node.relativePathCopied'));
      } else if (action === 'show-in-folder') {
        await showNodeInFolder(item);
      }
    } catch (error) {
      console.error('[useContextMenu] 节点操作失败:', error);
      const failure = getWorkspaceOperationFailure(error);
      notificationStore.show(failure
        ? resolveWorkspaceOperationFailure(
            failure,
            workspaceMessage,
            targetProjectId
              ? 'workspace.sidebar.node.transferFailed'
              : 'workspace.sidebar.node.unknownError',
          )
        : error instanceof WorkspaceNodeTransferSaveError
          ? error.message
          : workspaceMessage('workspace.sidebar.node.operationFailed', {
              nodeName: getNodeDisplayName(item, workspaceMessage),
            }), 'error');
    } finally {
      contextMenu.value.visible = false;
    }
  };

  /**
   * 删除节点（支持多选批量删除）
   */
  const handleDeleteItems = async (clickedNode) => {
    const selectedIds = selectionStore.selectedNodeIds;
    
    // 判断是删除多个还是单个
    const shouldDeleteMultiple = selectedIds.size > 1 && selectedIds.has(clickedNode.id);
    
    if (shouldDeleteMultiple) {
      // 批量删除
      const count = selectedIds.size;
      // 使用应用内确认框替代 window.confirm，避免 Windows 下原生模态导致焦点恢复异常
      const confirmed = await confirm({
        title: workspaceMessage('workspace.sidebar.node.batchDeleteTitle'),
        message: workspaceMessage('workspace.sidebar.node.batchDeleteMessage', { count }),
        confirmText: workspaceMessage('workspace.sidebar.node.deleteConfirm'),
        cancelText: workspaceMessage('workspace.sidebar.node.deleteCancel'),
        isDangerousAction: true,
      });
      if (!confirmed) return;
      try {
        const nodesToDelete = [];
        // 收集所有要删除的节点
        for (const nodeId of selectedIds) {
          const node = treeStore.findNodeById(nodeId);
          if (node) {
            nodesToDelete.push(node);
          }
        }
        
        const result = await nodeDeletion.deleteNodes(nodesToDelete.map((node) => ({
          id: node.id,
          parentId: node.parentId ?? null,
        })));
        const failCount = result.failures.length;
        const successCount = nodesToDelete.length - failCount;
        
        if (failCount === 0) {
          notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDeleteSuccess', { count: successCount }), 'success');
        } else {
          notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDeletePartial', { successCount, failCount }), 'warning');
        }
      } catch (error) {
        console.error('[useContextMenu] 批量删除失败:', error);
        notificationStore.show(workspaceMessage('workspace.sidebar.node.batchDeleteFailed'), 'error');
      }
    } else {
      // 单个删除
      if (!clickedNode) return;
      // 使用应用内确认框替代 window.confirm，避免 Windows 下原生模态导致焦点恢复异常
      const confirmed = await confirm({
        title: workspaceMessage('workspace.sidebar.node.deleteTitle'),
        message: workspaceMessage('workspace.sidebar.node.deleteMessage', { nodeName: getNodeDisplayName(clickedNode, workspaceMessage) }),
        confirmText: workspaceMessage('workspace.sidebar.node.deleteConfirm'),
        cancelText: workspaceMessage('workspace.sidebar.node.deleteCancel'),
        isDangerousAction: true,
      });
      if (!confirmed) return;
      try {
        const result = await nodeDeletion.deleteNodes([{
          id: clickedNode.id,
          parentId: clickedNode.parentId ?? null,
        }]);
        if (result.failures.length > 0) {
          throw new Error(result.failures[0]?.message ?? workspaceMessage('workspace.sidebar.node.deleteFailed'));
        }
        notificationStore.show(workspaceMessage('workspace.sidebar.node.deleted', { nodeName: getNodeDisplayName(clickedNode, workspaceMessage) }), 'success');
      } catch (error) {
        console.error('[useContextMenu] 删除失败:', error);
        notificationStore.show(workspaceMessage('workspace.sidebar.node.deleteFailed'), 'error');
      }
    }
  };

  return {
    contextMenu,
    handleContextMenuRequest,
    handleMenuSelect,
  };
}
