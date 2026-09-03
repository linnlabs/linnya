import type {
  WorkspaceDocumentLifecycleNodePort,
  WorkspaceDocumentLifecycleProviderResolver,
} from '../definitions/workspaceDocumentLifecycle';
import {
  normalizeWorkspaceDocumentName,
  normalizeWorkspaceDocumentType,
} from '../functions/normalizeWorkspaceDocumentCreateInput';
import { resolveWorkspaceDocumentLifecycleProvider } from '../functions/resolveWorkspaceDocumentLifecycleProvider';

export interface CreateWorkspaceDocumentParams {
  readonly workspace: WorkspaceDocumentLifecycleNodePort;
  readonly resolveProvider: WorkspaceDocumentLifecycleProviderResolver;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: unknown;
  readonly rawType?: unknown;
}

export async function createWorkspaceDocument(
  params: CreateWorkspaceDocumentParams,
): Promise<{ readonly documentId: string }> {
  const documentType = normalizeWorkspaceDocumentType(params.rawType);
  const provider = resolveWorkspaceDocumentLifecycleProvider({
    documentType,
    operation: 'create',
    resolveProvider: params.resolveProvider,
  });
  if (!provider.create) {
    throw new Error(`${provider.displayName} 不支持创建文档。`);
  }
  const desiredName = normalizeWorkspaceDocumentName({
    value: params.name,
    provider,
  });
  const availableName = params.workspace.createAvailableSiblingName({
    projectId: params.projectId,
    parentId: params.parentId,
    desiredName,
  });
  return provider.create({
    projectId: params.projectId,
    parentId: params.parentId,
    name: availableName,
  });
}
