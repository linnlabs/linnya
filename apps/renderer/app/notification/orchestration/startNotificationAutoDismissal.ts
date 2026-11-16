import { createTimer } from '@linnya/renderer-ui';
import { watch } from 'vue';
import {
  useNotificationStore,
  type NotificationStore,
} from '../store/notificationStore';

export function startNotificationAutoDismissal(
  notificationStore: NotificationStore = useNotificationStore(),
): () => void {
  const dismissal = createTimer();

  const stopWatching = watch(
    () => [notificationStore.isVisible, notificationStore.presentationRevision] as const,
    ([isVisible]) => {
      dismissal.cancel();
      if (!isVisible || notificationStore.duration <= 0) return;
      dismissal.start(() => notificationStore.hide(), notificationStore.duration);
    },
    { flush: 'sync' },
  );

  return () => {
    stopWatching();
    dismissal.cancel();
  };
}
