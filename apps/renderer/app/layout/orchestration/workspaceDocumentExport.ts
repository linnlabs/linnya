import {
  markActiveFileDirty,
  requestSave,
} from '@/domains/workspace/services/file-manager';
import {
  useWorkspaceProjectsStore,
  useWorkspaceSelectionStore,
  useWorkspaceTreeStore,
} from '@/domains/workspace/store';
import { getMarkdownDocumentEditorRuntimePort } from '@/shared/ports/markdownDocumentEditorRuntimePort';
import type {
  SaveWorkspaceHtmlDocumentResult,
  WorkspaceDocumentExportPort,
} from '@/shared/ports/workspaceDocumentExportPort';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { resolveCurrentLayoutMessage } from '../functions/resolveCurrentLayoutMessage';

function getParentIdForNewDocument(): string | null {
  const selectionStore = useWorkspaceSelectionStore();
  const treeStore = useWorkspaceTreeStore();
  const selectedNodeId = selectionStore.lastSelectedNodeId;
  if (!selectedNodeId) return null;

  const selectedNode = treeStore.findNodeById(selectedNodeId);
  if (!selectedNode) return null;

  return selectedNode.type === 'folder' ? selectedNode.id : selectedNode.parentId;
}

export function createWorkspaceDocumentExport(): WorkspaceDocumentExportPort {
  return {
    async saveHtmlAsMarkdownDocument(params): Promise<SaveWorkspaceHtmlDocumentResult> {
      const projectsStore = useWorkspaceProjectsStore();
      if (!projectsStore.activeProjectId) {
        return {
          success: false,
          error: resolveCurrentLayoutMessage('layout.workspaceDocumentExport.noActiveProject'),
        };
      }

      const treeStore = useWorkspaceTreeStore();
      const parentId = getParentIdForNewDocument();
      const documentId = await treeStore.createDocument({
        name: params.name,
        parentId,
        type: 'document',
        // 对话导出已经生成了明确标题，不应让侧边栏进入重命名态。
        requestRename: false,
        // 这条链路不经过工具投影，需要在创建处显式标记新文档。
        markAsNew: true,
      });

      await getWorkspaceNavigationPort().openDocument({
        documentId,
        type: 'editor',
        projectId: projectsStore.activeProjectId,
        displayName: params.name,
        parentId,
      });

      const editor = getMarkdownDocumentEditorRuntimePort().getReadyEditor();
      if (!editor) {
        return {
          success: false,
          error: resolveCurrentLayoutMessage('layout.workspaceDocumentExport.editorUnavailable'),
          documentId,
        };
      }

      editor.commands.setContent(params.html);
      markActiveFileDirty(true);

      const saveOk = await requestSave('manual');
      if (!saveOk) {
        return {
          success: true,
          documentId,
          error: resolveCurrentLayoutMessage('layout.workspaceDocumentExport.autoSaveFailed'),
        };
      }

      return {
        success: true,
        documentId,
      };
    },
  };
}
