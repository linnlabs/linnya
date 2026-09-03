<!--
  apps/renderer/domains/settings/ui/kit/SettingsFeedback.vue

  操作反馈条（保存成功 / 校验失败 / 连接结果）。message 为空时不渲染，
  业务层可以直接把 computed 的空串传进来，不用自己写 v-if。
-->
<template>
  <p
    v-if="message"
    class="settings-feedback"
    :class="`is-${kind}`"
    role="status"
  >
    {{ message }}
  </p>
</template>

<script setup lang="ts">
import type { SettingsFeedbackKind } from '../../definitions/settingsKit';

withDefaults(defineProps<{
  message: string;
  kind?: SettingsFeedbackKind;
}>(), {
  kind: 'info',
});
</script>
