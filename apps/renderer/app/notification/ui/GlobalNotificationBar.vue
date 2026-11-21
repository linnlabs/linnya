<template>
  <NotificationBar
    :visible="visible"
    :message="notificationStore.message"
    :type="notificationStore.type"
    :right="right"
  />
</template>

<script setup lang="ts">
import { NotificationBar } from '@linnya/renderer-ui';
import { computed } from 'vue';
import { useNotificationStore } from '../store/notificationStore';
import { useBackendHealthStore } from '../../backend-health/store/backendHealthStore';

const BASE_RIGHT_MARGIN = 20;

const props = withDefaults(defineProps<{
  readonly reservedTrailingWidth?: number;
}>(), {
  reservedTrailingWidth: 0,
});

const notificationStore = useNotificationStore();
const backendHealth = useBackendHealthStore();
const right = computed(() => BASE_RIGHT_MARGIN + props.reservedTrailingWidth);
// 后台停了，请求必然失败：错误由顶部状态条统一说明，不再逐条弹出。
const visible = computed(() => (
  notificationStore.isVisible && !(backendHealth.isUnavailable && notificationStore.type === 'error')
));
</script>
