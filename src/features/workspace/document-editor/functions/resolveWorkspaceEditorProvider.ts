import type {
  WorkspaceDocumentEditorProvider,
  WorkspaceDocumentEditorProviderResolver,
  WorkspaceEditorDocumentIdentity,
} from '../definitions/workspaceDocumentEditor';

export function resolveWorkspaceEditorProvider(params: {
  readonly identity: WorkspaceEditorDocumentIdentity;
  readonly resolveProvider: WorkspaceDocumentEditorProviderResolver;
  readonly action: '读取' | '写入';
}): WorkspaceDocumentEditorProvider {
  const provider = params.resolveProvider(params.identity.documentType);
  if (!provider) {
    throw new Error(
      `文档类型 ${params.identity.documentType} 不支持富文档 Editor ${params.action}。`,
    );
  }
  if (!provider.enabled) {
    throw new Error(provider.disabledMessage);
  }
  return provider;
}
