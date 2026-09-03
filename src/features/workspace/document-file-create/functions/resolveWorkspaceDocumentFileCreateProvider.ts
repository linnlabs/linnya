import type {
  WorkspaceDocumentFileCreateProvider,
  WorkspaceDocumentFileCreateProviderResolver,
} from '../definitions/workspaceDocumentFileCreate';

export function resolveWorkspaceDocumentFileCreateProvider(params: {
  readonly fileName: string;
  readonly resolveProvider: WorkspaceDocumentFileCreateProviderResolver;
}): WorkspaceDocumentFileCreateProvider | undefined {
  const provider = params.resolveProvider(params.fileName);
  if (provider && !provider.enabled) {
    throw new Error(provider.disabledMessage);
  }
  return provider;
}
