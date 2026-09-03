<template>
  <div
    class="slides-status-state"
    :class="`is-${tone}`"
  >
    <div
      class="status-icon"
      :class="{ spinning: tone === 'loading' }"
    >
      <LoadingIcon v-if="tone === 'loading'" />
      <InfoIcon v-else />
    </div>

    <p class="status-title">
      {{ title }}
    </p>
    <p
      v-if="description"
      class="status-description"
    >
      {{ description }}
    </p>

    <button
      v-if="actionLabel"
      type="button"
      class="status-action"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>

    <!-- 业务状态可在主操作之后补充日志、说明等内容，顺序由通用状态容器统一保证。 -->
    <slot />
  </div>
</template>

<script setup lang="ts">
import {
  InfoIcon,
  LoadingIcon,
} from '@linnya/renderer-ui/icons';

withDefaults(defineProps<{
  title: string;
  description?: string;
  actionLabel?: string;
  tone?: 'neutral' | 'error' | 'loading';
}>(), {
  description: undefined,
  actionLabel: undefined,
  tone: 'neutral',
});

defineEmits<{
  action: [];
}>();
</script>
