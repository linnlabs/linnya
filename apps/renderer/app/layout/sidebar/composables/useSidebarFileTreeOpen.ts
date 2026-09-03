import { onScopeDispose, type Ref } from 'vue';
import {
  resolveDocumentTypeByNodeType,
} from '@/app/plugins/registry';
import {
  logUnavailableDocumentTypeDiagnostics,
} from '@/app/plugins/documentTypeUnavailableDiagnostics';
import { getDocumentTypeUnavailableMessage } from '@/app/plugins/functions/documentTypeUnavailablePresentation';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import { useLocalization } from '@/app/localization';
import type { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import type { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import type { WorkspaceNode } from '@/domains/workspace/store';
import {
  createWorkspaceAssetImagePreviewController,
  type WorkspaceAssetImagePreviewPort,
  type WorkspaceAssetImagePreviewState,
} from '@/domains/workspace/features/asset-image-preview';
import type { IWorkspaceGateway } from '@/shared/ipc/workspaceGateway';
import { resolveWorkspaceNodeDisplayName } from '@/domains/workspace/functions/resolveWorkspaceNodeDisplayName';
import type { SidebarTextPreviewState } from './useSidebarAssetPreviewState';


interface SelectionStorePort {
  readonly lastSelectedNodeId: string | null;
  selectSingle(nodeId: string): void;
  toggleSelection(nodeId: string): void;
  selectRange(flatTree: WorkspaceNode[], endNodeId: string): void;
}

interface TreeStorePort {
  readonly flatProjectTree: WorkspaceNode[];
  toggleExpand(nodeId: string): void;
}

interface ProjectsStorePort {
  readonly activeProjectId: string | null;
}

interface NotificationStorePort {
  show(message: string, type?: string): void;
}

type EnabledPluginsStore = ReturnType<typeof useEnabledPluginsStore>;
type AssistantStore = ReturnType<typeof useAssistantStore>;

interface UseWorkspaceSidebarFileOpenOptions {
  treeStore: TreeStorePort;
  selectionStore: SelectionStorePort;
  projectsStore: ProjectsStorePort;
  assistantStore: AssistantStore;
  enabledPluginsStore: EnabledPluginsStore;
  notificationStore: NotificationStorePort;
  workspaceGateway: Pick<IWorkspaceGateway, 'read-vfs-node'>;
  imagePreviewApi: WorkspaceAssetImagePreviewPort;
  openDocumentByNodeType: (documentId: string, nodeType: string, fallbackName: string) => Promise<void>;
  imagePreview: Ref<WorkspaceAssetImagePreviewState>;
  textPreview: Ref<SidebarTextPreviewState>;
  workspaceMessage: WorkspaceMessageResolver;
}

const nonDocumentNodeTypes = new Set(['folder', 'asset_image', 'asset_file']);

export function useSidebarFileTreeOpen(options: UseWorkspaceSidebarFileOpenOptions) {
  const { t } = useLocalization();
  const imagePreviewController = createWorkspaceAssetImagePreviewController({
    api: options.imagePreviewApi,
    state: {
      replace(value) {
        options.imagePreview.value = value;
      },
    },
    mediaUrls: {
      buildImageUrl(filePath) {
        return window.linnyaMedia.buildImageUrl(filePath);
      },
    },
    objectUrls: {
      create: blob => URL.createObjectURL(blob),
      revoke: url => URL.revokeObjectURL(url),
    },
  });

  function closeAssetImagePreview(): void {
    imagePreviewController.close();
  }

  function handleImagePreviewLoadError(): void {
    imagePreviewController.handleImageLoadError(
      options.workspaceMessage('workspace.sidebar.node.imageLoadFailed'),
    );
  }

  onScopeDispose(() => imagePreviewController.dispose());

  function getNodeDisplayName(node: WorkspaceNode): string {
    return resolveWorkspaceNodeDisplayName(node, node.name);
  }

  const unavailableDocumentTypeMessage = (availability: ReturnType<typeof resolveDocumentTypeByNodeType>) =>
    getDocumentTypeUnavailableMessage(availability, {
      disabled: ({ documentType, pluginName }) => options.workspaceMessage('workspace.sidebar.node.unavailable.disabled', { documentType, pluginName }),
      missing: ({ documentType, pluginName }) => options.workspaceMessage('workspace.sidebar.node.unavailable.missing', { documentType, pluginName }),
      loadFailed: ({ documentType, pluginName }) => options.workspaceMessage('workspace.sidebar.node.unavailable.loadFailed', { documentType, pluginName }),
      unknown: ({ nodeType }) => options.workspaceMessage('workspace.sidebar.node.unavailable.unknown', { nodeType }),
      fallback: () => options.workspaceMessage('workspace.sidebar.node.unavailable.fallback'),
    }, (documentType) => resolveDocumentTypeTextPresentation(documentType, t).label);

  async function openAssetImagePreview(node: WorkspaceNode): Promise<void> {
    const payload = node.payload ?? {};
    const assetId = payload.imagePreviewAccess === 'verified_asset'
      && typeof payload.assetId === 'string'
      ? payload.assetId
      : null;
    const filePath = typeof payload.filePath === 'string' ? payload.filePath : null;
    const uri = typeof payload.uri === 'string' ? payload.uri : null;
    await imagePreviewController.open({
      name: getNodeDisplayName(node) || options.workspaceMessage('workspace.sidebar.node.imagePreview'),
      assetId,
      filePath,
      remoteUri: uri,
      loadErrorMessage: options.workspaceMessage('workspace.sidebar.node.imageLoadFailed'),
    });
  }

  async function openAssetFilePreview(node: WorkspaceNode): Promise<void> {
    const activeProjectId = options.projectsStore.activeProjectId;
    if (!activeProjectId) {
      options.notificationStore.show(options.workspaceMessage('workspace.sidebar.node.selectProjectFirst'), 'warning');
      return;
    }

    options.textPreview.value = {
      visible: true,
      loading: true,
      name: getNodeDisplayName(node) || options.workspaceMessage('workspace.sidebar.node.attachment'),
      text: '',
      error: '',
    };

    try {
      const result = await options.workspaceGateway['read-vfs-node']({
        projectId: activeProjectId,
        inode: node.inode || node.id,
        conversationId: options.assistantStore.activeConversationId,
        instanceId: 'default',
      });
      if (!result.success) throw new Error(result.error || options.workspaceMessage('workspace.sidebar.node.readAttachmentFailed'));
      if (!result.data.ok) throw new Error(result.data.message || options.workspaceMessage('workspace.sidebar.node.readAttachmentFailed'));
      options.textPreview.value.loading = false;
      options.textPreview.value.text = result.data.text;
    } catch (error) {
      console.error('[SidebarFileTreeOpen] 附件预览读取失败:', error);
      options.textPreview.value.loading = false;
      options.textPreview.value.error = options.workspaceMessage('workspace.sidebar.node.readAttachmentFailed');
    }
  }

  async function handleTreeItemClick({ node, event }: { node: WorkspaceNode; event: MouseEvent }): Promise<void> {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    const isCtrlOrCmd = (isMac && event.metaKey) || (!isMac && event.ctrlKey);
    const isPlainOpenClick = !event.shiftKey && !isCtrlOrCmd;
    const isKnownNonDocumentNode = nonDocumentNodeTypes.has(node.type);
    const documentAvailability = resolveDocumentTypeByNodeType(
      node.type,
      options.enabledPluginsStore.enabledPluginIds,
      options.enabledPluginsStore.states,
    );

    if (
      isPlainOpenClick &&
      documentAvailability.state !== 'enabled' &&
      (documentAvailability.state !== 'unknown' || !isKnownNonDocumentNode)
    ) {
      logUnavailableDocumentTypeDiagnostics({
        source: 'SidebarFileTreeOpen',
        documentId: node.id,
        nodeType: node.type,
        availability: documentAvailability,
        enabledPluginsStore: options.enabledPluginsStore,
        node: {
          id: node.id,
          type: node.type,
          name: node.name,
          projectId: node.projectId,
          inode: node.inode ?? null,
        },
      });
      options.notificationStore.show(unavailableDocumentTypeMessage(documentAvailability), 'warning');
      return;
    }

    if (event.shiftKey && options.selectionStore.lastSelectedNodeId) {
      options.selectionStore.selectRange(options.treeStore.flatProjectTree, node.id);
    } else if (isCtrlOrCmd) {
      options.selectionStore.toggleSelection(node.id);
    } else {
      options.selectionStore.selectSingle(node.id);
    }

    if (documentAvailability.state === 'enabled' && isPlainOpenClick) {
      const documentType = documentAvailability.documentType;
      const documentTypeText = resolveDocumentTypeTextPresentation(documentType, t);
      await options.openDocumentByNodeType(node.id, documentType.nodeType, documentTypeText.defaultName);
    } else if (node.type === 'asset_image' && isPlainOpenClick) {
      await openAssetImagePreview(node);
    } else if (node.type === 'asset_file' && isPlainOpenClick) {
      await openAssetFilePreview(node);
    } else if (node.type === 'folder' && !isCtrlOrCmd) {
      options.treeStore.toggleExpand(node.id);
    }
  }

  return {
    handleTreeItemClick,
    openAssetImagePreview,
    openAssetFilePreview,
    closeAssetImagePreview,
    handleImagePreviewLoadError,
  };
}
