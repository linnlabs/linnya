import type {
  WorkspaceDocumentEditorProviderResolver,
  WorkspaceEditorDocumentNodeReader,
  WorkspaceEditorDocumentReadResult,
} from '../definitions/workspaceDocumentEditor';
import { resolveWorkspaceEditorProvider } from '../functions/resolveWorkspaceEditorProvider';
import { toWorkspaceEditorDocumentIdentity } from '../functions/toWorkspaceEditorDocumentIdentity';

export async function readWorkspaceEditorDocument(params: {
  readonly documentId: string;
  readonly workspaceService: WorkspaceEditorDocumentNodeReader;
  readonly resolveProvider: WorkspaceDocumentEditorProviderResolver;
}): Promise<WorkspaceEditorDocumentReadResult> {
  const node = params.workspaceService.getNode(params.documentId);
  if (!node) {
    throw new Error(`Document not found: ${params.documentId}`);
  }
  const identity = toWorkspaceEditorDocumentIdentity(node);
  const provider = resolveWorkspaceEditorProvider({
    identity,
    resolveProvider: params.resolveProvider,
    action: '读取',
  });
  if (!provider.read) {
    throw new Error(`${provider.displayName} 不支持富文档 Editor 读取。`);
  }
  const result = await provider.read(identity);
  if (!result) {
    throw new Error(`Document not found: ${identity.documentId}`);
  }
  return {
    content: result.content,
    pendingRevisions: result.pendingRevisions,
  };
}
