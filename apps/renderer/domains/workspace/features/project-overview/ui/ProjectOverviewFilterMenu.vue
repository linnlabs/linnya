<template>
  <div class="project-overview-filter" :class="{ 'is-active': valueText !== null }">
    <button
      ref="triggerRef"
      type="button"
      class="project-overview-filter__trigger"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="project-overview-filter__text">{{ triggerText }}</span>
      <ChevronIcon v-if="valueText === null" class="project-overview-filter__chevron" />
    </button>
    <button
      v-if="valueText !== null"
      type="button"
      class="project-overview-filter__clear"
      :aria-label="clearLabel"
      :data-linnya-tooltip="clearLabel"
      @click="emit('clear')"
    >
      <CloseIcon />
    </button>
    <div v-if="isOpen" class="project-overview-filter__menu">
      <CustomSelect
        :model-value="modelValue"
        :options="options"
        :manual-mode="true"
        :parent-is-open="isOpen"
        semantic-role="menu"
        variant="minimal"
        :bordered="false"
        :external-trigger-ref="triggerRef"
        :enable-keyboard-nav="true"
        :show-selected-checkmark="true"
        options-max-height="320px"
        option-label-overflow="ellipsis"
        :class-names="{ options: 'project-overview-filter__options' }"
        @update:model-value="handleSelect"
        @close="isOpen = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChevronIcon, CloseIcon } from '@linnya/renderer-ui/icons';

const props = defineProps<{
  label: string;
  /** 选中项的显示文字；未筛选时为 null。 */
  valueText: string | null;
  /** 触发按钮上“类型：文档”这类组合文字。 */
  activeText: string;
  clearLabel: string;
  modelValue: string;
  options: readonly CustomSelectOption<string>[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  clear: [];
}>();

const triggerRef = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);
const triggerText = computed(() => (props.valueText === null ? props.label : props.activeText));

function handleSelect(value: string | null): void {
  isOpen.value = false;
  if (value !== null) emit('update:modelValue', value);
}
</script>
