import {
  ConversationRunDocumentChangesSchema,
  type ConversationRunDocumentChange,
  type WorkspaceMutationEvent,
} from '@app/schemas';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type {
  RunDocumentChangeItem,
  RunDocumentChangesPort,
} from '@/domains/conversation/features/run-document-changes';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { resolveDocumentTypeByNodeType } from '@/app/plugins/registry';
import {
  cancelDocumentHistoryPanelRequest,
  requestDocumentHistoryPanel,
} from '@/app/layout/orchestration/documentHistoryPanelRequest';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { subscribeToWorkspaceMutation } from '@/shared/ipc/workspaceMutationSubscription';
import { projectRunDocumentChangeItem } from '../functions/projectRunDocumentChangeItem';

function mutationTouches(event: WorkspaceMutationEvent, documentIds: ReadonlySet<string>): boolean {
  switch (event.type) {
    case 'workspace.document.updated':
      return documentIds.has(event.documentId);
    case 'workspace.node.deleted':
      return event.deletedNodeIds.some(id => documentIds.has(id));
    case 'workspace.node.transferred':
      return event.movedNodeIds.some(id => documentIds.has(id));
    case 'workspace.node.renamed':
    case 'workspace.node.moved':
      return documentIds.has(event.nodeId);
    default:
      return false;
  }
}

/**
 * 对话里“这次运行改了哪些文档”的跨域编排：读 Host 账本结果，按文档类型注册表决定图标、
 * 能否打开以及走审阅还是历史；打开仍走 Workspace 导航，历史由顶栏的文档历史面板负责。
 */
export function createRunDocumentChangesPort(): RunDocumentChangesPort {
  function toItem(change: ConversationRunDocumentChange): RunDocumentChangeItem {
    const plugins = useEnabledPluginsStore();
    const availability = resolveDocumentTypeByNodeType(change.node_type, plugins.enabledPluginIds, plugins.states);
    const documentType = availability.state === 'enabled' ? availability.documentType : null;
    return projectRunDocumentChangeItem(change, {
      activeDocumentType: documentType?.activeDocumentType ?? null,
      iconComponent: documentType?.iconComponent ?? DocumentIcon,
      iconClass: documentType?.iconClass ?? '',
      hasDocumentHistory: Boolean(documentType?.historyPreviewComponent),
    });
  }

  const port: RunDocumentChangesPort = {
    async list(request) {
      const response = await window.electronAPI.listConversationRunDocumentChanges({
        conversation_id: request.conversationId,
        root_run_ids: [...request.rootRunIds],
      });
      const result = ConversationRunDocumentChangesSchema.parse(response);
      return { items: result.documents.map(toItem), truncated: result.truncated };
    },
    async open(item, intent) {
      if (item.deleted || item.activeDocumentType === null) return;
      if (intent === 'history') requestDocumentHistoryPanel(item.documentId);
      try {
        await getWorkspaceNavigationPort().openDocument({
          documentId: item.documentId,
          type: item.activeDocumentType,
          projectId: item.projectId,
          displayName: item.title,
          parentId: item.parentId,
        });
      } catch (error: unknown) {
        cancelDocumentHistoryPanelRequest(item.documentId);
        throw error;
      }
    },
    watch(documentIds, onChange) {
      return subscribeToWorkspaceMutation((event) => {
        if (mutationTouches(event, documentIds)) onChange();
      });
    },
  };
  return Object.freeze(port);
}
