<template>
  <span
    ref="anchorRef"
    class="semantic-schema-pick"
  >
    <BaseButton
      variant="plain"
      size="sm"
      :disabled="disabled || options.length === 0"
      @click="isOpen = !isOpen"
    >
      {{ label }}
    </BaseButton>
    <Teleport to="body">
      <Transition name="project-overview-filter-menu-fade">
        <div
          v-if="isOpen"
          ref="menuRef"
          class="project-overview-filter__menu semantic-schema-pick__menu"
          :style="menuStyle"
        >
          <CustomSelect
            model-value=""
            :options="options"
            :manual-mode="true"
            :parent-is-open="isOpen"
            semantic-role="menu"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="anchorRef"
            :enable-keyboard-nav="true"
            options-max-height="280px"
            option-label-overflow="ellipsis"
            :class-names="{ options: 'project-overview-filter__options' }"
            @update:model-value="pick"
            @close="isOpen = false"
          />
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { BaseButton, CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import { useFixedDropdownPosition } from '@/domains/workspace/ui/sidebar';

/** 按钮加一个选项菜单（合并到哪个标签）；与文件页筛选菜单同一套定位和动效。 */
defineProps<{
  label: string;
  options: readonly CustomSelectOption<string>[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ pick: [value: string] }>();

const anchorRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const { dropdownRef: menuRef, dropdownStyle: menuStyle, positionDropdownAfterRender } = useFixedDropdownPosition({ align: 'start' });
watch(isOpen, open => {
  if (open) void positionDropdownAfterRender(anchorRef.value);
}, { flush: 'post' });

function pick(value: string | null): void {
  isOpen.value = false;
  if (value) emit('pick', value);
}
</script>
