import type {
  WorkspaceDocumentFileWriteProviderResolver,
  WorkspaceDocumentFileWriteRequest,
  WorkspaceDocumentFileWriteResult,
} from '../definitions/workspaceDocumentFileWrite';
import { resolveWorkspaceDocumentFileWriteProvider } from '../functions/resolveWorkspaceDocumentFileWriteProvider';

export async function writeWorkspaceDocumentFile(params: {
  readonly request: WorkspaceDocumentFileWriteRequest;
  readonly resolveProvider: WorkspaceDocumentFileWriteProviderResolver;
}): Promise<WorkspaceDocumentFileWriteResult> {
  const provider = resolveWorkspaceDocumentFileWriteProvider({
    documentType: params.request.identity.documentType,
    resolveProvider: params.resolveProvider,
  });
  return provider.write(params.request);
}
