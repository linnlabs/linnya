import { watch } from 'vue';
import {
  useNotificationStore,
  type NotificationStore,
} from '../store/notificationStore';

export function startNotificationAutoDismissal(
  notificationStore: NotificationStore = useNotificationStore(),
): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function clearScheduledDismissal(): void {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  const stopWatching = watch(
    () => [notificationStore.isVisible, notificationStore.presentationRevision] as const,
    ([isVisible]) => {
      clearScheduledDismissal();
      if (!isVisible || notificationStore.duration <= 0) return;

      timeoutId = setTimeout(() => {
        notificationStore.hide();
      }, notificationStore.duration);
    },
    { flush: 'sync' },
  );

  return () => {
    stopWatching();
    clearScheduledDismissal();
  };
}
