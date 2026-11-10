<!--
  对话详情右上角的“更多”菜单：与筛选菜单同一套弹出层（挂到 body、按按钮定位、共享动效）。
-->
<template>
  <IconButton
    ref="triggerRef"
    :label="label"
    size="md"
    :active="isOpen"
    aria-haspopup="menu"
    :aria-expanded="isOpen"
    @click="isOpen = !isOpen"
  >
    <MoreIcon />
  </IconButton>
  <Teleport to="body">
    <Transition name="project-overview-filter-menu-fade">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="project-overview-filter__menu project-conversation-more"
        :style="menuStyle"
      >
        <CustomSelect
          :model-value="null"
          :options="options"
          :manual-mode="true"
          :parent-is-open="isOpen"
          semantic-role="menu"
          variant="minimal"
          :bordered="false"
          :external-trigger-ref="triggerElement"
          :enable-keyboard-nav="true"
          options-max-height="320px"
          :class-names="{ options: 'project-overview-filter__options' }"
          @update:model-value="handleSelect"
          @close="isOpen = false"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts" generic="Action extends string">
import { computed, ref, watch, type ComponentPublicInstance } from 'vue';
import { CustomSelect, IconButton, resolveIconButtonElement, type CustomSelectOption } from '@linnya/renderer-ui';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { useFixedDropdownPosition } from '@/domains/workspace/ui/sidebar';

defineProps<{
  label: string;
  options: readonly CustomSelectOption<Action>[];
}>();

const emit = defineEmits<{
  select: [action: Action];
}>();

const triggerRef = ref<Element | ComponentPublicInstance | null>(null);
const triggerElement = computed(() => resolveIconButtonElement(triggerRef.value));
const isOpen = ref(false);
const {
  dropdownRef: menuRef,
  dropdownStyle: menuStyle,
  positionDropdownAfterRender,
} = useFixedDropdownPosition({ align: 'end' });
watch(isOpen, open => {
  if (open) void positionDropdownAfterRender(triggerElement.value);
}, { flush: 'post' });

function handleSelect(value: Action | null): void {
  isOpen.value = false;
  if (value !== null) emit('select', value);
}
</script>
