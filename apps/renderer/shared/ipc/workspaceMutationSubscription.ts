import type { WorkspaceMutationEvent } from '@app/schemas';

export type WorkspaceMutationUnsubscribe = () => void;

export function subscribeToWorkspaceMutation(
  callback: (event: WorkspaceMutationEvent) => void,
): WorkspaceMutationUnsubscribe {
  const api = window.electronAPI;
  if (typeof api?.onWorkspaceMutation !== 'function') {
    console.warn('[workspaceMutationSubscription] onWorkspaceMutation preload API 不可用，已跳过订阅。');
    return () => undefined;
  }

  return api.onWorkspaceMutation(callback);
}
