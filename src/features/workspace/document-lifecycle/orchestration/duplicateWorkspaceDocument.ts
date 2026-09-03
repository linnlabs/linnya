import {
  WorkspaceFolderDuplicateUnsupportedError,
  WorkspaceNodeMissingProjectError,
  WorkspaceNodeNotFoundError,
  WorkspaceSourceDocumentMissingError,
} from '../../definitions/workspaceErrors';
import type {
  WorkspaceDocumentLifecycleNodePort,
  WorkspaceDocumentLifecycleProviderResolver,
} from '../definitions/workspaceDocumentLifecycle';
import { resolveWorkspaceDocumentLifecycleProvider } from '../functions/resolveWorkspaceDocumentLifecycleProvider';

export async function duplicateWorkspaceDocument(params: {
  readonly workspace: WorkspaceDocumentLifecycleNodePort;
  readonly resolveProvider: WorkspaceDocumentLifecycleProviderResolver;
  readonly nodeId: string;
}): Promise<{ readonly nodeId: string }> {
  const sourceNode = params.workspace.getNode(params.nodeId);
  if (!sourceNode) {
    throw new WorkspaceNodeNotFoundError(params.nodeId);
  }
  if (!sourceNode.project_id) {
    throw new WorkspaceNodeMissingProjectError(params.nodeId);
  }
  if (sourceNode.type === 'folder') {
    throw new WorkspaceFolderDuplicateUnsupportedError(params.nodeId);
  }

  const provider = resolveWorkspaceDocumentLifecycleProvider({
    documentType: sourceNode.type,
    operation: 'duplicate',
    resolveProvider: params.resolveProvider,
  });
  if (!provider.duplicate) {
    throw new Error(`${provider.displayName} 不支持复制文档。`);
  }
  const newName = params.workspace.createAvailableSiblingCopyName({
    projectId: sourceNode.project_id,
    parentId: sourceNode.parent_id,
    sourceName: sourceNode.name,
  });
  const result = await provider.duplicate({
    sourceDocumentId: sourceNode.id,
    projectId: sourceNode.project_id,
    parentId: sourceNode.parent_id,
    name: newName,
  });
  if (!result) {
    throw new WorkspaceSourceDocumentMissingError(params.nodeId);
  }
  return { nodeId: result.documentId };
}
