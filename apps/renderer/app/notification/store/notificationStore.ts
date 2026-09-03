import type { NotificationType } from '@linnya/renderer-ui';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const DEFAULT_NOTIFICATION_DURATION_MS = 3_000;

export const useNotificationStore = defineStore('notification', () => {
  const isVisible = ref(false);
  const message = ref('');
  const type = ref<NotificationType>('info');
  const duration = ref(DEFAULT_NOTIFICATION_DURATION_MS);
  const presentationRevision = ref(0);

  function show(
    nextMessage: string,
    nextType: NotificationType = 'info',
    nextDuration = DEFAULT_NOTIFICATION_DURATION_MS,
  ): void {
    message.value = nextMessage;
    type.value = nextType;
    duration.value = nextDuration;
    // 同一条通知尚未关闭时也要产生新的展示请求，让计时编排重新起算。
    presentationRevision.value += 1;
    isVisible.value = true;
  }

  function hide(): void {
    isVisible.value = false;
  }

  return {
    duration,
    hide,
    isVisible,
    message,
    presentationRevision,
    show,
    type,
  };
});

export type NotificationStore = ReturnType<typeof useNotificationStore>;
