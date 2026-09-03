/**
 * @file useDocumentOperations.ts
 * @description 文档打开、创建、删除等操作逻辑
 */

import { ref } from 'vue';
import { useWorkspaceSelectionStore } from '../../../store/index.js';
import { confirm } from '../../../../../shared/composables/confirmDialog';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import {
  getDocumentTypeByCreateRequestType,
  resolveDocumentTypeByNodeType,
} from '@/app/plugins/registry';
import {
  logUnavailableDocumentTypeDiagnostics,
} from '@/app/plugins/documentTypeUnavailableDiagnostics';
import { getDocumentTypeUnavailableMessage } from '@/app/plugins/functions/documentTypeUnavailablePresentation';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { useLocalization } from '@/app/localization';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceNodeDisplayName } from '../../../functions/resolveWorkspaceNodeDisplayName';
import { getWorkspaceNodeDeletionPort } from '@/shared/ports/workspaceNodeDeletionPort';

interface WorkspaceSidebarNode {
  id: string;
  type: string;
  name?: string;
  displayName?: string;
  title?: string;
  projectId?: string | null;
  project_id?: string | null;
  parentId?: string | null;
}

interface WorkspaceTreeStorePort {
  flatProjectTree: WorkspaceSidebarNode[];
  findNodeById(nodeId: string): WorkspaceSidebarNode | null | undefined;
  createDocument(options: { name: string; parentId: string | null; type: string }): Promise<string>;
  createFolder(options: { name: string; parentId: string | null }): Promise<void>;
}

interface NotificationStorePort {
  show(message: string, type: 'success' | 'warning' | 'error'): void;
}

interface CreateNodeOptions {
  parentId?: string | null;
}

interface CreateFileOptions extends CreateNodeOptions {
  type?: string;
}

function getNodeDisplayName(node: WorkspaceSidebarNode, message: WorkspaceMessageResolver): string {
  return resolveWorkspaceNodeDisplayName(node, message('workspace.sidebar.node.fallbackName'));
}

export function useDocumentOperations(
  treeStore: WorkspaceTreeStorePort,
  _uiStore: unknown,
  _fileStore: unknown,
  notificationStore: NotificationStorePort,
) {
  const selectionStore = useWorkspaceSelectionStore();
  const enabledPluginsStore = useEnabledPluginsStore();
  const navigation = getWorkspaceNavigationPort();
  const nodeDeletion = getWorkspaceNodeDeletionPort();
  const { workspaceMessage } = useWorkspaceLocalization();
  const { t } = useLocalization();
  const errorDialogVisible = ref(false);
  const errorMessage = ref('');

  const showError = (message: string) => {
    errorMessage.value = message;
    errorDialogVisible.value = true;
  };

  const unavailableDocumentTypeMessage = (availability: ReturnType<typeof resolveDocumentTypeByNodeType>) =>
    getDocumentTypeUnavailableMessage(availability, {
      disabled: ({ documentType, pluginName }) => workspaceMessage('workspace.sidebar.node.unavailable.disabled', { documentType, pluginName }),
      missing: ({ documentType, pluginName }) => workspaceMessage('workspace.sidebar.node.unavailable.missing', { documentType, pluginName }),
      loadFailed: ({ documentType, pluginName }) => workspaceMessage('workspace.sidebar.node.unavailable.loadFailed', { documentType, pluginName }),
      unknown: ({ nodeType }) => workspaceMessage('workspace.sidebar.node.unavailable.unknown', { nodeType }),
      fallback: () => workspaceMessage('workspace.sidebar.node.unavailable.fallback'),
    }, (documentType) => resolveDocumentTypeTextPresentation(documentType, t).label);

  /**
   * 通过 workspace navigation port 发起打开意图。
   * 中文说明：侧栏只知道 workspace nodeType，真正打开哪个 surface 由 documentType 贡献声明。
   */
  const openDocumentByNodeType = async (documentId: string, nodeType: string, fallbackName: string) => {
    try {
      const availability = resolveDocumentTypeByNodeType(
        nodeType,
        enabledPluginsStore.enabledPluginIds,
        enabledPluginsStore.states,
      );
      if (availability.state !== 'enabled') {
        logUnavailableDocumentTypeDiagnostics({
          source: 'useDocumentOperations',
          documentId,
          nodeType,
          availability,
          enabledPluginsStore,
        });
        throw new Error(unavailableDocumentTypeMessage(availability));
      }
      const documentType = availability.documentType;
      const documentTypeText = resolveDocumentTypeTextPresentation(documentType, t);

      const documentNode = treeStore.findNodeById(documentId);
      if (!documentNode) {
        console.warn(`[useDocumentOperations] 在文件树中未找到 ${nodeType} ${documentId}，使用兜底信息继续打开。`);
      }
      const projectId = documentNode?.projectId ?? documentNode?.project_id ?? null;
      const displayName = documentNode ? getNodeDisplayName(documentNode, workspaceMessage) : fallbackName;
      await navigation.openDocument({
        documentId,
        type: documentType.activeDocumentType,
        projectId,
        displayName,
        parentId: documentNode?.parentId ?? null,
      });
      selectionStore.selectSingle(documentId);

      console.log(`[useDocumentOperations] ${documentTypeText.label} ${documentId} 已打开`);
    } catch (error) {
      console.error('[useDocumentOperations] openDocumentByNodeType failed:', error);
      showError(workspaceMessage('workspace.sidebar.node.openFailed', {
        documentName: fallbackName,
      }));
    }
  };

  /**
   * 获取新节点的父ID
   */
  const getParentIdForNewNode = (explicitParentId: string | null | undefined = undefined): string | null => {
    if (explicitParentId !== undefined) {
      return explicitParentId;
    }

    const selectedNodeId = selectionStore.lastSelectedNodeId;
    console.log('[useDocumentOperations] Getting parent ID, selectedNodeId:', selectedNodeId);
    if (!selectedNodeId) {
      console.log('[useDocumentOperations] No node selected, creating at root.');
      return null;
    }
    const selectedNode = treeStore.findNodeById(selectedNodeId);
    if (!selectedNode) {
      console.warn('[useDocumentOperations] Selected node not found in tree, creating at root.');
      return null;
    }
    const parentId = selectedNode.type === 'folder' ? selectedNode.id : selectedNode.parentId ?? null;
    console.log(`[useDocumentOperations] Determined parentId: ${parentId}`);
    return parentId;
  };

  /**
   * 创建新文件
   */
  const createNewFile = async (options: CreateFileOptions = {}) => {
    const type = options?.type || 'document';
    console.log('[useDocumentOperations] createNewFile called.', { type });
    const parentId = getParentIdForNewNode(options?.parentId);
    try {
      const documentType = getDocumentTypeByCreateRequestType(type);
      if (!documentType) {
        throw new Error(workspaceMessage('workspace.sidebar.node.unregisteredCreateType', { type }));
      }
      if (!enabledPluginsStore.isPluginEnabled(documentType.pluginId)) {
        const documentTypeText = resolveDocumentTypeTextPresentation(documentType, t);
        throw new Error(workspaceMessage('workspace.sidebar.node.pluginDisabled', { documentType: documentTypeText.label }));
      }
      const documentTypeText = resolveDocumentTypeTextPresentation(documentType, t);
      const defaultName = documentTypeText.defaultName;
      
      // 调用 treeStore 的 createDocument，它会根据 type 自动调用正确的后端 API
      const documentId = await treeStore.createDocument({ name: defaultName, parentId, type });
      
      console.log('[useDocumentOperations] createDocument finished successfully.', { type, documentId });
      selectionStore.selectSingle(documentId);
      
      // 创建后自动打开
      await openDocumentByNodeType(documentId, documentType.nodeType, documentTypeText.defaultName);

    } catch (error) {
      console.error('[useDocumentOperations] createNewFile failed:', error);
      notificationStore.show(workspaceMessage('workspace.sidebar.node.createFileFailed'), 'error');
    }
  };

  /**
   * 创建新文件夹
   */
  const createNewFolder = async (options: CreateNodeOptions = {}) => {
    console.log('[useDocumentOperations] createNewFolder called.');
    const parentId = getParentIdForNewNode(options?.parentId);
    try {
      await treeStore.createFolder({ name: workspaceMessage('workspace.sidebar.node.untitledFolder'), parentId });
      console.log('[useDocumentOperations] createFolder finished successfully.');
    } catch (error) {
      console.error('[useDocumentOperations] createNewFolder failed:', error);
      notificationStore.show(workspaceMessage('workspace.sidebar.node.createFolderFailed'), 'error');
    }
  };

  /**
   * 删除节点
   */
  const handleDeleteItem = async (node: WorkspaceSidebarNode | null | undefined) => {
    if (!node) return;
    // 使用应用内确认框替代 window.confirm，避免 Windows 下原生模态导致焦点恢复异常
    const confirmed = await confirm({
      title: workspaceMessage('workspace.sidebar.node.deleteTitle'),
      message: workspaceMessage('workspace.sidebar.node.deleteMessage', {
        nodeName: getNodeDisplayName(node, workspaceMessage),
      }),
      confirmText: workspaceMessage('workspace.sidebar.node.deleteConfirm'),
      cancelText: workspaceMessage('workspace.sidebar.node.deleteCancel'),
      isDangerousAction: true,
    });
    if (!confirmed) return;
    try {
      const result = await nodeDeletion.deleteNodes([{
        id: node.id,
        parentId: node.parentId ?? null,
      }]);
      if (result.failures.length > 0) {
        throw new Error(result.failures[0]?.message ?? workspaceMessage('workspace.sidebar.node.deleteFailed'));
      }
      notificationStore.show(workspaceMessage('workspace.sidebar.node.deleted', {
        nodeName: getNodeDisplayName(node, workspaceMessage),
      }), 'success');
    } catch (error) {
      console.error('[useDocumentOperations] deleteNode failed:', error);
      notificationStore.show(workspaceMessage('workspace.sidebar.node.deleteFailed'), 'error');
    }
  };

  return {
    errorDialogVisible,
    errorMessage,
    showError,
    openDocumentByNodeType,
    createNewFile,
    createNewFolder,
    handleDeleteItem,
  };
}
