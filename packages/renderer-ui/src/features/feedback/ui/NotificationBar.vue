<template>
  <Transition name="notification-fade">
    <div
      v-if="visible"
      class="notification-bar"
      :class="`notification-type-${type}`"
      :style="{ right: `${right}px` }"
    >
      <div class="notification-icon">
        <span v-if="type === 'success'">✓</span>
        <span v-else-if="type === 'error'">✕</span>
        <span v-else-if="type === 'info'">ℹ</span>
        <span v-else-if="type === 'warning'">⚠</span>
      </div>
      <div class="notification-content">
        {{ message }}
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { NotificationBarProps } from '../definitions/notificationBar';

withDefaults(defineProps<NotificationBarProps>(), {
  visible: false,
  type: 'info',
  right: 20,
});
</script>
