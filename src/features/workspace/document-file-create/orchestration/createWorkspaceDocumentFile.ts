import type {
  WorkspaceDocumentFileCreateProviderResolver,
  WorkspaceDocumentFileCreateRequest,
  WorkspaceDocumentFileCreateResult,
} from '../definitions/workspaceDocumentFileCreate';
import { resolveWorkspaceDocumentFileCreateProvider } from '../functions/resolveWorkspaceDocumentFileCreateProvider';

export async function createWorkspaceDocumentFile(params: {
  readonly request: WorkspaceDocumentFileCreateRequest;
  readonly resolveProvider: WorkspaceDocumentFileCreateProviderResolver;
}): Promise<WorkspaceDocumentFileCreateResult | undefined> {
  const provider = resolveWorkspaceDocumentFileCreateProvider({
    fileName: params.request.name,
    resolveProvider: params.resolveProvider,
  });
  return provider?.create(params.request);
}
