import type {
  WorkspaceDocumentEditorProviderResolver,
  WorkspaceEditorDocumentNodeReader,
  WorkspaceEditorDocumentWriteResult,
} from '../definitions/workspaceDocumentEditor';
import { resolveWorkspaceEditorProvider } from '../functions/resolveWorkspaceEditorProvider';
import { toWorkspaceEditorDocumentIdentity } from '../functions/toWorkspaceEditorDocumentIdentity';

export async function writeWorkspaceEditorDocument(params: {
  readonly documentId: string;
  readonly content: unknown;
  readonly workspaceService: WorkspaceEditorDocumentNodeReader;
  readonly resolveProvider: WorkspaceDocumentEditorProviderResolver;
}): Promise<WorkspaceEditorDocumentWriteResult> {
  const node = params.workspaceService.getNode(params.documentId);
  if (!node) {
    throw new Error(`Document not found: ${params.documentId}`);
  }
  const identity = toWorkspaceEditorDocumentIdentity(node);
  const provider = resolveWorkspaceEditorProvider({
    identity,
    resolveProvider: params.resolveProvider,
    action: '写入',
  });
  if (!provider.write) {
    throw new Error(`${provider.displayName} 不支持富文档 Editor 写入。`);
  }
  return provider.write(identity, params.content);
}
