import {
  ConversationFileLinkResolutionSchema,
  type ConversationFileLinkResolution,
} from '@app/schemas';
import {
  type ConversationResourceLinkPort,
  type ConversationResourceLinkTarget,
} from '@/domains/conversation/features/resource-link';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { resolveDocumentTypeByNodeType } from '@/app/plugins/registry';

function unavailableWorkspace(
  resolution: Extract<ConversationFileLinkResolution, { state: 'ready'; kind: 'workspace' }>,
): ConversationResourceLinkTarget {
  return {
    state: 'unavailable',
    locator: resolution.locator,
    issue_code: 'workspace_target_not_openable',
  };
}

export function createConversationResourceLinkPort(): ConversationResourceLinkPort {
  const port: ConversationResourceLinkPort = {
    async resolve(request) {
      const response = await window.electronAPI.resolveConversationFileLink(request);
      if (!response.success) {
        throw new Error(response.error);
      }
      const resolution = ConversationFileLinkResolutionSchema.parse(response.data);
      if (resolution.state !== 'ready' || resolution.kind !== 'workspace') {
        return resolution;
      }
      const plugins = useEnabledPluginsStore();
      const availability = resolveDocumentTypeByNodeType(
        resolution.node_type,
        plugins.enabledPluginIds,
        plugins.states,
      );
      if (availability.state !== 'enabled') {
        return unavailableWorkspace(resolution);
      }
      return {
        ...resolution,
        activeDocumentType: availability.documentType.activeDocumentType,
        iconComponent: availability.documentType.iconComponent,
        iconClass: availability.documentType.iconClass,
      };
    },
    async open({ conversationId, target }) {
      if (target.kind === 'workspace') {
        await getWorkspaceNavigationPort().openDocument({
          documentId: target.document_id,
          type: target.activeDocumentType,
          projectId: target.project_id,
          displayName: target.title,
          parentId: target.parent_id,
        });
        return;
      }
      const response = await window.electronAPI.revealConversationFileLink({
        conversation_id: conversationId,
        locator: target.locator,
      });
      if (!response.success) {
        throw new Error(response.error);
      }
    },
  };
  return Object.freeze(port);
}
