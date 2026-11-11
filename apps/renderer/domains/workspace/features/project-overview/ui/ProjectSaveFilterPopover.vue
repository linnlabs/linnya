<!--
  保存筛选条件 / 重命名筛选的小弹层：挂到 body、贴着触发按钮。
  条件与已保存的某一项相同时，先提示打开那一项，用户坚持时仍然保存。
-->
<template>
  <Teleport to="body">
    <Transition name="project-overview-filter-menu-fade">
      <form
        v-if="open"
        ref="panelRef"
        :class="[DROPDOWN_SURFACE_CLASSES.root, DROPDOWN_SURFACE_CLASSES.panel, 'project-overview-save']"
        :style="panelStyle"
        role="dialog"
        :aria-label="title"
        @submit.prevent="submit"
        @keydown.esc.stop.prevent="emit('cancel')"
      >
        <p class="project-overview-save__title">{{ title }}</p>
        <CustomTextInput
          ref="inputRef"
          v-model="name"
          size="compact"
          :placeholder="placeholder"
          :maxlength="PROJECT_SAVED_FILTER_NAME_MAX_LENGTH"
        />
        <p v-if="duplicateNotice" class="project-overview-save__notice">{{ duplicateNotice }}</p>
        <p v-else-if="hint" class="project-overview-save__hint">{{ hint }}</p>
        <ActionButtons
          class="project-overview-save__actions"
          secondary-variant="plain"
          :primary-action-text="duplicateNotice ? openDuplicateText : primaryText"
          :secondary-action-text="duplicateNotice ? saveAnywayText : cancelText"
          :is-primary-action-disabled="!duplicateNotice && !name.trim()"
          @primary-click="duplicateNotice ? emit('open-duplicate') : submit()"
          @secondary-click="duplicateNotice ? submit() : emit('cancel')"
        />
      </form>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { PROJECT_SAVED_FILTER_NAME_MAX_LENGTH } from '@app/schemas';
import { ActionButtons, CustomTextInput, DROPDOWN_SURFACE_CLASSES } from '@linnya/renderer-ui';
import { useFixedDropdownPosition } from '@/domains/workspace/ui/sidebar';

const props = defineProps<{
  open: boolean;
  anchor: HTMLElement | null;
  align: 'start' | 'end';
  title: string;
  initialName: string;
  placeholder: string;
  primaryText: string;
  cancelText: string;
  hint: string | null;
  /** 条件相同的已有筛选的提示；null 为没有。 */
  duplicateNotice: string | null;
  openDuplicateText: string;
  saveAnywayText: string;
}>();

const emit = defineEmits<{
  submit: [name: string];
  'open-duplicate': [];
  cancel: [];
}>();

const name = ref('');
const inputRef = ref<{ focus: () => void } | null>(null);
const startPosition = useFixedDropdownPosition({ align: 'start' });
const endPosition = useFixedDropdownPosition({ align: 'end' });
const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

async function place(): Promise<void> {
  const position = props.align === 'end' ? endPosition : startPosition;
  await nextTick();
  position.dropdownRef.value = panelRef.value;
  position.positionDropdown(props.anchor);
  panelStyle.value = position.dropdownStyle.value as Record<string, string>;
}

watch(() => props.open, async open => {
  if (!open) return;
  name.value = props.initialName;
  await place();
  // 从右键菜单打开时，菜单关闭会把焦点还给页签；等它收尾后再聚焦输入框并全选名称。
  requestAnimationFrame(() => {
    inputRef.value?.focus();
    panelRef.value?.querySelector('input')?.select();
  });
}, { flush: 'post' });

function submit(): void {
  const trimmed = name.value.trim();
  if (trimmed) emit('submit', trimmed);
}

function closeOnOutside(event: PointerEvent): void {
  const target = event.target instanceof Node ? event.target : null;
  if (target && (panelRef.value?.contains(target) || props.anchor?.contains(target))) return;
  emit('cancel');
}
watch(() => props.open, open => {
  if (open) document.addEventListener('pointerdown', closeOnOutside, true);
  else document.removeEventListener('pointerdown', closeOnOutside, true);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside, true));
</script>
