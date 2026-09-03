<template>
  <NotificationBar
    :visible="notificationStore.isVisible"
    :message="notificationStore.message"
    :type="notificationStore.type"
    :right="right"
  />
</template>

<script setup lang="ts">
import { NotificationBar } from '@linnya/renderer-ui';
import { computed } from 'vue';
import { useNotificationStore } from '../store/notificationStore';

const BASE_RIGHT_MARGIN = 20;

const props = withDefaults(defineProps<{
  readonly reservedTrailingWidth?: number;
}>(), {
  reservedTrailingWidth: 0,
});

const notificationStore = useNotificationStore();
const right = computed(() => BASE_RIGHT_MARGIN + props.reservedTrailingWidth);
</script>
