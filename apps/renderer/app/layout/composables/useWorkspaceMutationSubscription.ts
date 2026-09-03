import { onBeforeUnmount, onMounted } from 'vue';
import { subscribeToWorkspaceMutation, type WorkspaceMutationUnsubscribe } from '@/shared/ipc/workspaceMutationSubscription';
import { getWorkspaceMutationEffectsPort } from '@/shared/ports/workspaceMutationEffectsPort';

export function useWorkspaceMutationSubscription(): void {
  let unsubscribe: WorkspaceMutationUnsubscribe | null = null;

  onMounted(() => {
    unsubscribe = subscribeToWorkspaceMutation((event) => {
      void getWorkspaceMutationEffectsPort()
        .handleWorkspaceMutation(event)
        .catch((error: unknown) => {
          console.warn('[workspaceMutationSubscription] 处理 workspace mutation 失败。', error);
        });
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
}
