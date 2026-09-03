import type { Ref } from 'vue';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { getPluginDocumentCreationHandler } from '@plugin/renderer/pluginDocumentCreationPort';
import { getDocumentTypeByCreateRequestType } from '@/app/plugins/registry';
import type { WorkspaceNode } from '@/domains/workspace/definitions/workspaceTree';
import type { WorkspaceOperationFailure } from '@/domains/workspace/definitions/workspaceOperationFailure';
import { resolveCurrentWorkspaceMessage } from '@/domains/workspace/functions/resolveCurrentWorkspaceMessage';
import { resolveWorkspaceOperationFailure } from '@/domains/workspace/functions/resolveWorkspaceOperationFailure';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';

type CreateDocumentResult =
  | { success: true; data?: { documentId: string } }
  | WorkspaceOperationFailure & { success: false };

export interface CreateWorkspaceTreeDocumentInput {
  readonly name: string;
  readonly parentId: string | null;
  readonly type?: string;
  /** 手动创建默认进入重命名；自动创建可以显式关闭。 */
  readonly requestRename?: boolean;
  /** 是否展示当前会话的 New 标记。 */
  readonly markAsNew?: boolean;
}

interface WorkspaceTreeNodeMutationDependencies {
  readonly error: Ref<string | null>;
  readonly findNodeById: (nodeId: string) => WorkspaceNode | null;
  readonly loadNodeChildren: (node: WorkspaceNode) => Promise<void>;
  readonly reloadActiveProjectTree: () => Promise<void>;
  readonly setRenameRequestNodeId: (nodeId: string | null) => void;
  readonly markNodeAsNew: (nodeId: string) => void;
}

export interface WorkspaceTreeNodeMutations {
  createFolder(args: { name: string; parentId: string | null }): Promise<string>;
  createDocument(args: CreateWorkspaceTreeDocumentInput): Promise<string>;
  renameNode(nodeId: string, newName: string): Promise<void>;
  duplicateNode(nodeId: string): Promise<string>;
  deleteNode(nodeId: string, parentId: string | null): Promise<string[]>;
}

function resolveOperationFailure(
  failure: WorkspaceOperationFailure,
  fallbackKey: Parameters<typeof resolveCurrentWorkspaceMessage>[0],
): string {
  return resolveWorkspaceOperationFailure(failure, resolveCurrentWorkspaceMessage, fallbackKey);
}

export function createWorkspaceTreeNodeMutations(
  dependencies: WorkspaceTreeNodeMutationDependencies,
): WorkspaceTreeNodeMutations {
  function getActiveProjectId(): string {
    const projectId = useWorkspaceProjectsStore().activeProjectId;
    if (!projectId) throw new Error('No active project');
    return projectId;
  }

  async function refreshParent(parentId: string | null): Promise<void> {
    if (!parentId) {
      await dependencies.reloadActiveProjectTree();
      return;
    }

    const parent = dependencies.findNodeById(parentId);
    if (!parent) {
      await dependencies.reloadActiveProjectTree();
      return;
    }
    parent.isExpanded = true;
    await dependencies.loadNodeChildren(parent);
  }

  async function createFolder(args: {
    name: string;
    parentId: string | null;
  }): Promise<string> {
    const result = await workspaceGateway['create-folder']({
      projectId: getActiveProjectId(),
      name: args.name,
      parentId: args.parentId,
    });
    if (!result.success) {
      dependencies.error.value = resolveOperationFailure(
        result,
        'workspace.sidebar.node.createFolderFailed',
      );
      throw new Error(result.error);
    }

    await refreshParent(args.parentId);
    dependencies.setRenameRequestNodeId(result.data.folderId);
    return result.data.folderId;
  }

  async function createDocument(args: CreateWorkspaceTreeDocumentInput): Promise<string> {
    const createRequestType = args.type ?? 'document';
    const documentType = getDocumentTypeByCreateRequestType(createRequestType);
    if (!documentType) {
      throw new Error(`[WorkspaceTreeNodeMutations] 未注册的新建文档类型: ${createRequestType}`);
    }

    let result: CreateDocumentResult;
    if (documentType.createBackend === 'plugin-document') {
      if (!documentType.createHandlerId) {
        throw new Error(
          `[WorkspaceTreeNodeMutations] 插件文档类型缺少 createHandlerId: ${documentType.activeDocumentType}`,
        );
      }
      result = await getPluginDocumentCreationHandler(documentType.createHandlerId).createDocument({
        projectId: getActiveProjectId(),
        parentId: args.parentId,
        name: args.name,
        createRequestType: documentType.createRequestType,
      });
    } else {
      result = await workspaceGateway['create-document']({
        projectId: getActiveProjectId(),
        name: args.name,
        parentId: args.parentId,
        type: documentType.createRequestType,
      });
    }

    if (!result.success) {
      dependencies.error.value = resolveOperationFailure(
        result,
        'workspace.sidebar.node.createFileFailed',
      );
      throw new Error(result.error);
    }
    if (!result.data) {
      throw new Error(
        `[WorkspaceTreeNodeMutations] 创建文档成功但缺少 documentId: ${documentType.createRequestType}`,
      );
    }

    await refreshParent(args.parentId);
    const documentId = result.data.documentId;
    if (args.markAsNew === true) dependencies.markNodeAsNew(documentId);
    if (args.requestRename !== false) dependencies.setRenameRequestNodeId(documentId);
    return documentId;
  }

  async function renameNode(nodeId: string, newName: string): Promise<void> {
    const result = await workspaceGateway['rename-node']({ nodeId, newName });
    if (!result.success) {
      dependencies.error.value = resolveOperationFailure(result, 'workspace.sidebar.node.renameFailed');
      throw new Error(result.error);
    }

    const node = dependencies.findNodeById(nodeId);
    if (node) node.name = newName;
    dependencies.setRenameRequestNodeId(null);
  }

  async function duplicateNode(nodeId: string): Promise<string> {
    const result = await workspaceGateway['duplicate-node']({ nodeId });
    if (!result.success) {
      dependencies.error.value = resolveOperationFailure(
        result,
        'workspace.sidebar.node.duplicateFailed',
      );
      throw new Error(result.error);
    }

    await refreshParent(dependencies.findNodeById(nodeId)?.parentId ?? null);
    return result.data.nodeId;
  }

  async function deleteNode(nodeId: string, parentId: string | null): Promise<string[]> {
    const result = await workspaceGateway['delete-node']({ nodeId });
    if (!result.success) {
      dependencies.error.value = resolveOperationFailure(result, 'workspace.sidebar.node.deleteFailed');
      throw new Error(result.error);
    }

    await refreshParent(parentId);
    return result.data.deletedNodeIds;
  }

  return {
    createFolder,
    createDocument,
    renameNode,
    duplicateNode,
    deleteNode,
  };
}
