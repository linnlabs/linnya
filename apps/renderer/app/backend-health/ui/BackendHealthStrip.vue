<template>
  <div
    v-if="status !== 'ok'"
    class="backend-health-strip"
    :class="`is-${tone}`"
    role="status"
    aria-live="polite"
  >
    <span class="backend-health-strip__icon" aria-hidden="true">
      <LoadingIcon v-if="tone === 'progress'" />
      <CheckmarkIcon v-else-if="tone === 'success'" />
      <InfoIcon v-else />
    </span>
    <span class="backend-health-strip__text">{{ text }}</span>
    <span v-if="status === 'stopped'" class="backend-health-strip__actions">
      <BaseButton variant="plain" size="sm" @click="openLogFolder">{{ message('backendHealth.actions.openLogFolder') }}</BaseButton>
      <BaseButton variant="secondary" size="sm" @click="restart">{{ message('backendHealth.actions.restart') }}</BaseButton>
    </span>
    <span v-else-if="status === 'unresponsive'" class="backend-health-strip__actions">
      <BaseButton variant="secondary" size="sm" @click="confirmOpen = true">
        {{ message('backendHealth.actions.restartBackend') }}
      </BaseButton>
    </span>
  </div>
  <AlertDialog
    :visible="confirmOpen"
    is-confirmation
    :title="message('backendHealth.restartConfirm.title')"
    :message="message('backendHealth.restartConfirm.message')"
    :confirm-text="message('backendHealth.actions.restart')"
    @confirm="confirmRestart"
    @cancel="confirmOpen = false"
    @close="confirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { AlertDialog, BaseButton } from '@linnya/renderer-ui';
import { CheckmarkIcon, InfoIcon, LoadingIcon } from '@linnya/renderer-ui/icons';
import { useLocalization } from '@app/localization';
import { useNotificationStore } from '@app/notification';
import type { BackendHealthMessageKey } from '../definitions/backendHealthMessages';
import { BACKEND_HEALTH_MESSAGE_FALLBACKS } from '../definitions/backendHealthMessageCatalog';
import { useBackendHealthStore } from '../store/backendHealthStore';

const { status } = storeToRefs(useBackendHealthStore());
const { message: localize } = useLocalization();
const notifications = useNotificationStore();
const confirmOpen = ref(false);

const message = (key: BackendHealthMessageKey): string => localize(key, BACKEND_HEALTH_MESSAGE_FALLBACKS[key]);

const tone = computed(() => {
  switch (status.value) {
    case 'restarting': return 'progress';
    case 'recovered': return 'success';
    case 'unresponsive': return 'warning';
    default: return 'error';
  }
});

const text = computed(() => {
  switch (status.value) {
    case 'restarting': return message('backendHealth.restarting');
    case 'recovered': return message('backendHealth.recovered');
    case 'unresponsive': return message('backendHealth.unresponsive');
    default: return message('backendHealth.stopped');
  }
});

// 后台恢复响应后确认框没有意义了。
watch(status, next => {
  if (next !== 'unresponsive') confirmOpen.value = false;
});

function reportRestartFailure(error: unknown): void {
  console.error('[backend-health] 重新启动失败', error);
  // 后台不可用时错误类通知会被这条状态条代替，所以用 warning。
  notifications.show(message('backendHealth.restartFailed'), 'warning', 0);
}

function restart(): void {
  window.electronAPI.appServerHealth.restart().catch(reportRestartFailure);
}

function confirmRestart(): void {
  confirmOpen.value = false;
  restart();
}

function openLogFolder(): void {
  window.electronAPI.appServerHealth.openLogFolder().catch((error: unknown) => {
    console.error('[backend-health] 打开日志文件夹失败', error);
  });
}
</script>
