<!-- TextPopover.vue -->
<!-- 纯文本弹窗组件：点击触发器后弹出显示一段文本内容 -->

<template>
  <div ref="containerRef" class="text-popover">
    <!-- 触发器：可以是按钮、图标或文本 -->
    <button 
      v-if="!externalTriggerRef"
      ref="triggerRef"
      type="button"
      class="popover-trigger"
      :class="triggerClass"
      @click="handleTriggerClick"
      @mouseenter="handleTriggerMouseEnter"
      @mouseleave="handleTriggerMouseLeave"
      :title="computedTriggerTitle"
    >
      <slot name="trigger">
        {{ triggerText }}
      </slot>
    </button>

    <!-- 弹出的文本内容面板 -->
    <transition name="popover-fade">
      <div 
        v-if="computedIsOpen" 
        ref="popoverRef"
        class="popover-panel"
        :data-placement="resolvedPlacement"
        :style="popoverPosition"
        @mouseenter="handlePanelMouseEnter"
        @mouseleave="handlePanelMouseLeave"
      >
        <div class="popover-content">
          <!-- 自定义内容插槽 -->
          <slot name="content">
            <div class="popover-text" v-html="content"></div>
          </slot>
        </div>
        
        <!-- 可选的关闭按钮 -->
        <button 
          v-if="showCloseButton"
          class="popover-close-btn"
          @click="closePopover"
          :title="closeLabel"
          :aria-label="closeLabel"
        >
          <CloseIcon class="popover-close-icon" />
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, isRef, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type {
  DropdownElementReference,
  TextPopoverPlacement,
  TextPopoverTriggerMode,
} from '../definitions/selectMenu';
import { CloseIcon } from '../../../icons';
import { useAnchoredPosition } from '../../anchored-position';
import { useSharedComponentLocalization } from '../../../localization';

interface TextPopoverProps {
  content?: string;
  triggerText?: string;
  triggerTitle?: string;
  triggerClass?: string;
  showCloseButton?: boolean;
  placement?: TextPopoverPlacement;
  maxWidth?: string;
  manualMode?: boolean;
  externalTriggerRef?: DropdownElementReference;
  isOpen?: boolean;
  triggerMode?: TextPopoverTriggerMode;
}

const props = withDefaults(defineProps<TextPopoverProps>(), {
  content: '',
  triggerText: '?',
  triggerTitle: '',
  triggerClass: '',
  showCloseButton: false,
  placement: 'auto',
  maxWidth: '300px',
  manualMode: false,
  externalTriggerRef: null,
  isOpen: false,
  triggerMode: 'click',
});

const emit = defineEmits<{
  open: [];
  close: [];
}>();

defineSlots<{
  trigger(): unknown;
  content(): unknown;
}>();
const { sharedComponentMessage } = useSharedComponentLocalization();

// Refs
const containerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const internalIsOpen = ref(false);
let closeTimer: number | null = null;
let delayedListenerTimer: number | null = null;

const isHoverMode = computed(() => props.triggerMode === 'hover');
// 说明：hover 模式下避免浏览器原生 title tooltip 与弹出卡片叠加冲突
const resolvedTriggerTitle = computed(() => (
  props.triggerTitle || sharedComponentMessage('shared.textPopover.triggerTitle')
));
const closeLabel = computed(() => sharedComponentMessage('shared.modal.close'));
const computedTriggerTitle = computed(() => (isHoverMode.value ? '' : resolvedTriggerTitle.value));

// 计算最终的打开状态
const computedIsOpen = computed(() => {
  return props.manualMode ? props.isOpen : internalIsOpen.value;
});

const triggerRef = ref<HTMLElement | null>(null);
const anchorElement = computed(() => {
  const external = isRef(props.externalTriggerRef) ? props.externalTriggerRef.value : props.externalTriggerRef;
  return external instanceof HTMLElement ? external : triggerRef.value;
});
// auto 优先放下方、放不下翻到上方；指定方向时不翻转，只收进视口。
const anchored = useAnchoredPosition({
  anchor: anchorElement,
  floating: popoverRef,
  open: computedIsOpen,
  placement: () => (props.placement === 'auto'
    ? { side: 'bottom', align: 'start' }
    : { side: props.placement, align: 'start', flip: false }),
});
// 面板实际落在触发点的哪一侧；进出动画据此选择缩放原点。
const resolvedPlacement = anchored.side;
const popoverPosition = computed<CSSProperties>(() => ({ ...anchored.style.value, maxWidth: props.maxWidth }));

/**
 * 切换弹窗
 */
const togglePopover = () => {
  if (props.manualMode) {
    if (computedIsOpen.value) {
      emit('close');
    } else {
      emit('open');
    }
  } else {
    internalIsOpen.value = !internalIsOpen.value;
  }
};

/**
 * 打开弹窗（统一入口）
 */
const openPopover = () => {
  if (props.manualMode) {
    emit('open');
  } else {
    internalIsOpen.value = true;
  }
};

/**
 * 关闭弹窗
 */
const closePopover = () => {
  if (props.manualMode) {
    emit('close');
  } else {
    internalIsOpen.value = false;
  }
};

const clearCloseTimer = () => {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
};

/**
 * 触发器点击：仅 click 模式生效
 */
const handleTriggerClick = () => {
  if (isHoverMode.value) return;
  togglePopover();
};

/**
 * 触发器 hover：仅 hover 模式生效
 */
const handleTriggerMouseEnter = () => {
  if (!isHoverMode.value) return;
  clearCloseTimer();
  openPopover();
};

const handleTriggerMouseLeave = () => {
  if (!isHoverMode.value) return;
  clearCloseTimer();
  // 留一点时间给鼠标移动到面板，避免“闪关”
  closeTimer = window.setTimeout(() => {
    closePopover();
  }, 120);
};

/**
 * 面板 hover：用于 hover 模式下“从触发器移动到面板”时保持打开
 */
const handlePanelMouseEnter = () => {
  if (!isHoverMode.value) return;
  clearCloseTimer();
};

const handlePanelMouseLeave = () => {
  if (!isHoverMode.value) return;
  clearCloseTimer();
  closePopover();
};

/**
 * 计算弹窗位置
 */
/**
 * 处理点击外部关闭
 */
const handleClickOutside = (event: MouseEvent) => {
  const container = containerRef.value;
  const triggerReference = props.externalTriggerRef;
  const trigger = isRef(triggerReference) ? triggerReference.value : triggerReference;
  const target = event.target;
  
  if (container && target instanceof Node && !container.contains(target)) {
    if (trigger instanceof HTMLElement && trigger.contains(target)) {
      return; // 点击的是外部触发器，不关闭
    }
    closePopover();
  }
};

// 监听打开状态变化，计算位置
watch(computedIsOpen, (newValue) => {
  if (newValue) {
    emit('open');
  } else {
    emit('close');
  }
});

onMounted(() => {
  // 延迟添加监听器，避免当前点击事件触发关闭
  delayedListenerTimer = window.setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
    delayedListenerTimer = null;
  }, 150);
});

onBeforeUnmount(() => {
  if (delayedListenerTimer !== null) window.clearTimeout(delayedListenerTimer);
  document.removeEventListener('click', handleClickOutside);
  clearCloseTimer();
});

// 暴露方法
defineExpose({
  open: () => {
    if (!props.manualMode) {
      internalIsOpen.value = true;
    }
  },
  close: closePopover,
  toggle: togglePopover
});
</script>
