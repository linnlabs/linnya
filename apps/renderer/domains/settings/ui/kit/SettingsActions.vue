<!--
  apps/renderer/domains/settings/ui/kit/SettingsActions.vue

  设置页底部的操作区。包一层 shared ActionButtons，统一「忙碌时禁用全部按钮」
  这条各页原本各写各的规则。
-->
<template>
  <div class="settings-actions">
    <ActionButtons
      :secondary-action-text="secondaryText"
      :primary-action-text="primaryText"
      :show-secondary-action="Boolean(secondaryText)"
      :is-secondary-action-disabled="busy || secondaryDisabled"
      :is-primary-action-disabled="busy || primaryDisabled"
      @secondary-click="emit('secondary')"
      @primary-click="emit('primary')"
    />
  </div>
</template>

<script setup lang="ts">
import { ActionButtons } from '@linnya/renderer-ui';

withDefaults(defineProps<{
  primaryText: string;
  secondaryText?: string;
  /** 保存 / 测试进行中：两个按钮一起禁用。 */
  busy?: boolean;
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
}>(), {
  secondaryText: '',
  busy: false,
  primaryDisabled: false,
  secondaryDisabled: false,
});

const emit = defineEmits<{
  primary: [];
  secondary: [];
}>();
</script>
