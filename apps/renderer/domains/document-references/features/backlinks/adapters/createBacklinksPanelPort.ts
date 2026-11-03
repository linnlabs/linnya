import { readDocumentBacklinks, readDocumentReference } from '@plugin/renderer/documentReferences';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { subscribeToWorkspaceMutation } from '@shared/ipc/workspaceMutationSubscription';
import type { BacklinksPanelPort } from '../definitions/backlinksPanel';

export function createBacklinksPanelPort(projectId: string): BacklinksPanelPort {
  return {
    list: readDocumentBacklinks,
    subscribe: listener => subscribeToWorkspaceMutation(() => listener()),
    async open(source) {
      // 列表打开后来源可能已移动/删除；导航前重新核对项目，不能沿缓存标题打开越界文档。
      const current = await readDocumentReference({
        projectId,
        documentId: source.sourceDocumentId,
      });
      if (
        !current.nodeType ||
        (current.status !== 'available' && current.status !== 'plugin_unavailable')
      )
        throw new Error('Backlink source is no longer accessible');
      await getWorkspaceNavigationPort().openDocumentTarget({
        projectId,
        documentId: current.documentId,
        type: current.nodeType,
        displayName: current.title,
      });
    },
  };
}
