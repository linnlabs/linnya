<!--
  @file ConversationCitationNode.vue
  @description 会话引用节点组件

  用于渲染 AI 回答中的 [@XXXXXX] 引用标记（支持 KB 和 Web 来源）。
  - 显示为可点击的数字徽章
  - 鼠标悬停时显示引用卡片弹窗
  - 点击时可跳转到知识库文档（未来功能）
-->
<template>
  <span
    ref="triggerRef"
    class="conversation-citation-node"
    :class="{ 'has-citation': !!citation, 'no-citation': !citation }"
    role="button"
    tabindex="0"
    :aria-label="conversationMessage('conversation.citation.ariaLabel')"
    :data-citation-ref="props.citationRef || undefined"
    :data-turn-id="props.turnId || undefined"
    :data-display-index="displayIndexText || undefined"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @click="handleClick"
    @keydown.enter="handleClick"
  >
    [{{ displayIndexText }}]
  </span>

  <!-- 引用弹窗 -->
  <ConversationCitationPopover
    :visible="showPopover"
    :citation="citation"
    :trigger-element="triggerRef"
    :loading="loading"
    :error="error"
    @close="hidePopover"
    @mouseenter="handlePopoverMouseEnter"
    @mouseleave="handlePopoverMouseLeave"
  />
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { SearchResultCitation } from '@app/schemas';
import { useConversationLocalization } from '../../../useConversationLocalization';
import ConversationCitationPopover from './ConversationCitationPopover.vue';

// ============================================================================
// Props
// ============================================================================

interface Props {
  /**
   * 稳定短引用（新引用体系：AI 输出 [@XXXXXX]）
   */
  citationRef?: string;

  /**
   * 展示用的连续编号（1..N）
   * - 由渲染层按"在答案中首次出现顺序"生成
   */
  displayIndex?: number;

  /** 对话轮次 ID（写入 transfer DOM，复制/导出时绑定所属消息范围） */
  turnId?: string;

  /** 当前消息依赖闭包中与 citationRef 对应的严格引用事实。 */
  citation?: SearchResultCitation;
}

const props = defineProps<Props>();

// ============================================================================
const { conversationMessage } = useConversationLocalization();

// ============================================================================
// Refs & State
// ============================================================================

const triggerRef = ref<HTMLElement | null>(null);
const showPopover = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
/**
 * 展示编号（重排后的 1..N）
 */
const displayIndexText = computed(() => {
  if (typeof props.displayIndex === 'number' && Number.isFinite(props.displayIndex)) {
    return props.displayIndex;
  }
  return '';
});


// 用于延迟隐藏弹窗（让用户可以移动到弹窗上）
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const HIDE_DELAY = 150;

// ============================================================================
// 计算属性
// ============================================================================

/**
 * 获取引用数据
 */
const citation = computed<SearchResultCitation | null>(() => props.citation ?? null);

/**
 * 说明：
 * - 这里不要再使用 title 提示（浏览器会在 hover 一段时间后弹出原生 tooltip，体验割裂且容易"挡住"引用卡片）
 * - 引用信息统一在 popover 中展示
 */

// ============================================================================
// 方法
// ============================================================================

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    showPopover.value = false;
  }, HIDE_DELAY);
}

function handleMouseEnter(): void {
  clearHideTimer();
  showPopover.value = true;
}

function handleMouseLeave(): void {
  scheduleHide();
}

function handlePopoverMouseEnter(): void {
  clearHideTimer();
}

function handlePopoverMouseLeave(): void {
  scheduleHide();
}

function hidePopover(): void {
  showPopover.value = false;
}

function handleClick(): void {
  showPopover.value = true;
}

// ============================================================================
// 生命周期
// ============================================================================

onUnmounted(() => {
  clearHideTimer();
});
</script>
