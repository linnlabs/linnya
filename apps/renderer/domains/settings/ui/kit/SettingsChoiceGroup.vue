<!--
  apps/renderer/domains/settings/ui/kit/SettingsChoiceGroup.vue

  「带说明的单选卡」列表：搜索引擎、密钥来源、权限级别都是这个形状。
  在件套出现之前，这个结构在三个 tab 里各写了一遍、各起了一套 class。
-->
<template>
  <div
    class="settings-choice-group"
    :aria-busy="busy || undefined"
  >
    <CustomRadio
      v-for="option in options"
      :key="option.value"
      :model-value="modelValue"
      :value="option.value"
      :name="name"
      :disabled="disabled || option.disabled"
      :data-choice="option.value"
      :class="{ 'is-danger': option.tone === 'danger' }"
      @update:model-value="handleSelect"
    >
      <span class="settings-choice-copy">
        <span class="settings-choice-name-row">
          <span class="settings-choice-name">{{ option.label }}</span>
          <span
            v-if="option.badge"
            class="settings-choice-badge"
          >{{ option.badge }}</span>
        </span>
        <span
          v-if="option.description"
          class="settings-choice-description"
        >{{ option.description }}</span>
      </span>
    </CustomRadio>
  </div>
</template>

<script setup lang="ts">
import { CustomRadio } from '@linnya/renderer-ui';
import type { SettingsChoiceOption } from '../../definitions/settingsKit';

defineProps<{
  modelValue: string;
  options: readonly SettingsChoiceOption[];
  /** radio 组名，同一页面内需唯一。 */
  name: string;
  disabled?: boolean;
  /** 正在读取时置为 true，暴露 aria-busy 给辅助技术。 */
  busy?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function handleSelect(value: string | number | boolean): void {
  if (typeof value === 'string') emit('update:modelValue', value);
}
</script>
