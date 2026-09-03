import type {
  WorkspaceDocumentFileWriteProvider,
  WorkspaceDocumentFileWriteProviderResolver,
} from '../definitions/workspaceDocumentFileWrite';

export function resolveWorkspaceDocumentFileWriteProvider(params: {
  readonly documentType: string;
  readonly resolveProvider: WorkspaceDocumentFileWriteProviderResolver;
}): WorkspaceDocumentFileWriteProvider {
  const provider = params.resolveProvider(params.documentType);
  if (!provider) {
    throw new Error(`文档类型 ${params.documentType} 不支持通用文件写入。`);
  }
  if (!provider.enabled) {
    throw new Error(provider.disabledMessage);
  }
  return provider;
}
