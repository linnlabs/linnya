import type { WorkspaceDocumentLifecycleProvider } from '../definitions/workspaceDocumentLifecycle';

export function normalizeWorkspaceDocumentType(value: unknown): string {
  const type = typeof value === 'string' ? value.trim() : '';
  return type.length > 0 ? type : 'document';
}

export function normalizeWorkspaceDocumentName(params: {
  readonly value: unknown;
  readonly provider: WorkspaceDocumentLifecycleProvider;
}): string {
  return typeof params.value === 'string' && params.value.trim().length > 0
    ? params.value.trim()
    : params.provider.defaultDocumentName;
}
