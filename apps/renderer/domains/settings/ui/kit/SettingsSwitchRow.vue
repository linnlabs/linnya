<!--
  apps/renderer/domains/settings/ui/kit/SettingsSwitchRow.vue

  开关行。SettingsRow + shared Switch 的组合糖：标签与说明占满左侧、开关贴右。
  设置页里所有的布尔项都走这里，不要再手写 .toggle-switch。
-->
<template>
  <SettingsRow
    :label="label"
    :description="description"
    control="end"
    align="center"
  >
    <Switch
      :model-value="modelValue"
      :ariaLabel="ariaLabel ?? label"
      :disabled="disabled"
      @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    />
  </SettingsRow>
</template>

<script setup lang="ts">
import { Switch } from '@linnya/renderer-ui';
import SettingsRow from './SettingsRow.vue';

defineProps<{
  modelValue: boolean;
  label: string;
  description?: string;
  /** 默认复用 label；标签本身不足以说明开关含义时再单独传。 */
  ariaLabel?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>
