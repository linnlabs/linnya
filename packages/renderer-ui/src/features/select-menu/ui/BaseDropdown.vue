<!-- BaseDropdown.vue -->
<!-- 基础下拉框组件：提供触发器和内容面板的通用框架 -->

<template>
  <div ref="containerRef" class="base-dropdown">
    <!-- 触发器插槽：由父组件决定触发器的外观 -->
    <slot
      name="trigger"
      :toggle="toggle"
      :open="open"
      :close="close"
      :is-open="computedIsOpen"
    ></slot>

    <!-- 内容面板插槽：由父组件决定显示什么内容 -->
    <slot 
      name="content" 
      :is-open="computedIsOpen"
      :close="close"
    ></slot>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef } from 'vue';
import type { DropdownElementReference } from '../definitions/selectMenu';
import { useDropdown } from '../composables/useDropdown';

interface BaseDropdownProps {
  manualMode?: boolean;
  externalTriggerRef?: DropdownElementReference;
  externalContentRef?: DropdownElementReference;
  isOpen?: boolean;
}

const props = withDefaults(defineProps<BaseDropdownProps>(), {
  manualMode: false,
  externalTriggerRef: null,
  externalContentRef: null,
  isOpen: false,
});

const emit = defineEmits<{
  close: [];
  open: [];
}>();

defineSlots<{
  trigger(props: {
    toggle: (event?: Event) => void;
    open: (event?: Event) => void;
    close: () => void;
    isOpen: boolean;
  }): unknown;
  content(props: { isOpen: boolean; close: () => void }): unknown;
}>();

// 容器引用
// 重要：必须是真实 DOM ref，用于「点击外部关闭」时判断点击是否发生在下拉内容内部
const containerRef = ref<HTMLElement | null>(null);

// 将外部触发器 prop 转为响应式 ref，确保 useDropdown 能拿到更新后的 DOM 元素
const externalTriggerRef = toRef(props, 'externalTriggerRef');
const externalContentRef = toRef(props, 'externalContentRef');

// 使用下拉框核心逻辑
const {
  isOpen: internalIsOpen,
  toggle: toggleInternal,
  open: openInternal,
  close: closeInternal,
} = useDropdown({
  manualMode: props.manualMode,
  containerRef,
  externalTriggerRef,
  dropdownRef: externalContentRef,
  onClose: () => {
    if (computedIsOpen.value) emit('close');
  },
});

// 计算最终的打开状态
const computedIsOpen = computed(() => {
  return props.manualMode ? props.isOpen : internalIsOpen.value;
});

const focusReturnTarget = ref<HTMLElement | null>(null);

const rememberFocusReturnTarget = (event?: Event) => {
  const eventTarget = event?.currentTarget;
  if (eventTarget instanceof HTMLElement) {
    focusReturnTarget.value = eventTarget;
    return;
  }

  if (document.activeElement instanceof HTMLElement) {
    focusReturnTarget.value = document.activeElement;
  }
};

const open = (event?: Event) => {
  rememberFocusReturnTarget(event);
  if (props.manualMode) {
    emit('open');
  } else {
    openInternal();
  }
};

const close = () => {
  if (props.manualMode) {
    emit('close');
  } else {
    closeInternal();
  }
};

const toggle = (event?: Event) => {
  rememberFocusReturnTarget(event);
  if (props.manualMode) {
    if (computedIsOpen.value) emit('close');
    else emit('open');
  } else {
    toggleInternal();
  }
};

/**
 * Escape 关闭后必须把焦点还给本次打开菜单的触发器。
 * 点击外部关闭不主动搬移焦点，保留用户刚刚点击的真实目标。
 */
const handleEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !computedIsOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  close();
  const target = focusReturnTarget.value;
  if (target) void nextTick(() => target.focus());
};

onMounted(() => document.addEventListener('keydown', handleEscape));
onBeforeUnmount(() => document.removeEventListener('keydown', handleEscape));

// 暴露方法给父组件
defineExpose({
  toggle,
  open,
  close,
  isOpen: computedIsOpen,
});
</script>
