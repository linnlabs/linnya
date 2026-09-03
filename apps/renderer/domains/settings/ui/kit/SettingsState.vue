<!--
  apps/renderer/domains/settings/ui/kit/SettingsState.vue

  加载中 / 空 / 读取失败 / 能力不可用 四种占位状态。
  在件套出现之前，这四种状态在四个 tab 里有四套写法。
-->
<template>
  <div
    class="settings-state"
    :class="`is-${kind}`"
    :role="kind === 'error' || kind === 'unavailable' ? 'alert' : 'status'"
  >
    <span class="settings-state-message">{{ message }}</span>
    <div
      v-if="$slots.action"
      class="settings-state-action"
    >
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SettingsStateKind } from '../../definitions/settingsKit';

defineProps<{
  kind: SettingsStateKind;
  message: string;
}>();
</script>
