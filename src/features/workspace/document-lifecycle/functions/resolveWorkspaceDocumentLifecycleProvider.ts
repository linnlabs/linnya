import { WorkspaceDocumentLifecycleProviderMissingError } from '../../definitions/workspaceErrors';
import type {
  WorkspaceDocumentLifecycleProvider,
  WorkspaceDocumentLifecycleProviderResolver,
} from '../definitions/workspaceDocumentLifecycle';

export function resolveWorkspaceDocumentLifecycleProvider(params: {
  readonly documentType: string;
  readonly operation: 'create' | 'duplicate';
  readonly resolveProvider: WorkspaceDocumentLifecycleProviderResolver;
}): WorkspaceDocumentLifecycleProvider {
  const provider = params.resolveProvider(params.documentType);
  if (!provider) {
    throw new WorkspaceDocumentLifecycleProviderMissingError(
      params.documentType,
      params.operation,
    );
  }
  if (!provider.enabled) {
    throw new Error(provider.disabledMessage);
  }
  return provider;
}
