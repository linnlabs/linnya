<!-- TextPopover.vue -->
<!-- 纯文本弹窗组件：点击触发器后弹出显示一段文本内容 -->

<template>
  <div ref="containerRef" class="text-popover">
    <!-- 触发器：可以是按钮、图标或文本 -->
    <button 
      v-if="!externalTriggerRef"
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
          ✕
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type {
  DropdownElementReference,
  TextPopoverPlacement,
  TextPopoverTriggerMode,
} from '../definitions/selectMenu';
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
let positionAnimationFrame: number | null = null;

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

// 弹窗位置
const popoverPosition = ref<CSSProperties>({
  top: '0px',
  left: '0px',
  maxWidth: props.maxWidth
});

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
const calculatePosition = () => {
  const externalTrigger = isRef(props.externalTriggerRef)
    ? props.externalTriggerRef.value
    : props.externalTriggerRef;
  const internalTrigger = containerRef.value?.querySelector('.popover-trigger');
  const trigger = externalTrigger instanceof HTMLElement
    ? externalTrigger
    : internalTrigger instanceof HTMLElement
      ? internalTrigger
      : null;
  const popover = popoverRef.value;
  
  if (!trigger || !popover) return;
  
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let top = 0;
  let left = 0;
  
  // 根据 placement 计算位置
  if (props.placement === 'auto') {
    // 自动选择最佳位置
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const spaceRight = viewportWidth - triggerRect.right;
    const spaceLeft = triggerRect.left;
    
    // 优先显示在下方
    if (spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove) {
      top = triggerRect.bottom + 8;
      left = triggerRect.left;
    } else {
      // 显示在上方
      top = triggerRect.top - popoverRect.height - 8;
      left = triggerRect.left;
    }
    
    // 确保不超出右边界
    if (left + popoverRect.width > viewportWidth - 8) {
      left = viewportWidth - popoverRect.width - 8;
    }
    
    // 确保不超出左边界
    if (left < 8) {
      left = 8;
    }
    
    // 确保不超出上下边界
    if (top < 8) {
      top = 8;
    }
    if (top + popoverRect.height > viewportHeight - 8) {
      top = viewportHeight - popoverRect.height - 8;
    }
  } else if (props.placement === 'bottom') {
    top = triggerRect.bottom + 8;
    left = triggerRect.left;
  } else if (props.placement === 'top') {
    top = triggerRect.top - popoverRect.height - 8;
    left = triggerRect.left;
  } else if (props.placement === 'right') {
    top = triggerRect.top;
    left = triggerRect.right + 8;
  } else if (props.placement === 'left') {
    top = triggerRect.top;
    left = triggerRect.left - popoverRect.width - 8;
  }
  
  popoverPosition.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: props.maxWidth
  };
};

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
watch(computedIsOpen, async (newValue) => {
  if (newValue) {
    emit('open');
    await nextTick();
    // 等待渲染后计算位置
    if (positionAnimationFrame !== null) cancelAnimationFrame(positionAnimationFrame);
    positionAnimationFrame = requestAnimationFrame(() => {
      calculatePosition();
      positionAnimationFrame = null;
    });
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
  if (positionAnimationFrame !== null) cancelAnimationFrame(positionAnimationFrame);
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
