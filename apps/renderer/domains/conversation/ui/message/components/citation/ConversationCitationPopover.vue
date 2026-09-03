<template>
  <Teleport to="body">
    <Transition name="citation-popover-fade">
      <div
        v-if="visible"
        ref="popoverRef"
        class="citation-popover"
        :style="popoverStyle"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <!-- 加载状态 -->
        <div v-if="loading" class="citation-loading">
          <div class="loading-spinner"></div>
          <span>{{ conversationMessage('conversation.citation.loading') }}</span>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="error" class="citation-error">
          <span class="error-icon">⚠️</span>
          <span>{{ error }}</span>
        </div>

        <!-- 内容 -->
        <div v-else-if="citation" class="citation-content">
          <!-- Web 来源 -->
          <template v-if="isWebCitation">
            <div class="citation-header">
              <div class="doc-info">
                <LinkIcon class="doc-icon web-icon" />
                <span class="doc-title" :title="citation.docTitle">{{ citation.docTitle }}</span>
              </div>
              <a
                v-if="webUrl"
                class="web-open-link"
                :href="webUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop.prevent="handleOpenWebUrl"
              >
                {{ conversationMessage('conversation.citation.openWebPage') }}
              </a>
            </div>
            <div class="citation-body">
              <!-- 元信息：左侧（域名 · 作者）+ 右侧（时间） -->
              <div v-if="displayDomain || webPublishedAt || webAuthor" class="web-meta-line">
                <div class="web-meta-left">
                  <span v-if="displayDomain" class="web-meta-seg">{{ displayDomain }}</span>
                  <span v-if="webAuthor" class="web-meta-seg">{{ webAuthor }}</span>
                </div>
                <span v-if="webPublishedAt" class="web-meta-date">{{ webPublishedAt }}</span>
              </div>
              <div class="citation-snippet">
                {{ displaySnippet }}
              </div>
            </div>
          </template>

          <!-- KB 来源 -->
          <template v-else>
            <div class="citation-header">
              <div class="doc-info">
                <DocumentIcon class="doc-icon" />
                <span class="doc-title" :title="citation.docTitle">{{ citation.docTitle }}</span>
              </div>
              <span v-if="knowledgeCitation?.pageNumber" class="page-badge">
                {{ conversationMessage('conversation.citation.page', { page: knowledgeCitation.pageNumber }) }}
              </span>
            </div>
            <div class="citation-body">
              <div class="citation-snippet">
                {{ displaySnippet }}
              </div>
            </div>
          </template>
        </div>

        <!-- 空状态 -->
        <div v-else class="citation-empty">
          {{ conversationMessage('conversation.citation.empty') }}
        </div>

        <!-- 箭头指示器 -->
        <div
          ref="arrowRef"
          class="popover-arrow"
          :class="arrowPosition"
          :style="arrowStyle"
        ></div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { SearchResultCitation } from '@app/schemas';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { LinkIcon } from '@linnya/renderer-ui/icons';
import { openExternalUrl } from '../../../../../../shared/utils/openExternalUrl';
import { useConversationLocalization } from '../../../useConversationLocalization';
import {
  autoUpdate,
  computePosition,
  flip,
  offset as floatingOffset,
  shift,
  arrow as floatingArrow,
} from '@floating-ui/dom';

// ============================================================================
// Props & Emits
// ============================================================================

interface Props {
  /** 是否显示 */
  visible: boolean;

  /** 引用数据 */
  citation: SearchResultCitation | null;

  /** 触发元素（用于定位） */
  triggerElement: HTMLElement | null;

  /** 加载中状态 */
  loading?: boolean;

  /** 错误信息 */
  error?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: null,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'mouseenter'): void;
  (e: 'mouseleave'): void;
}>();

const { conversationMessage } = useConversationLocalization();

// ============================================================================
// Refs
// ============================================================================

const popoverRef = ref<HTMLElement | null>(null);
const arrowRef = ref<HTMLElement | null>(null);
const arrowPosition = ref<'top' | 'bottom'>('top');
const popoverStyle = ref<Record<string, string>>({ display: 'none' });
const arrowStyle = ref<Record<string, string>>({});
let cleanupAutoUpdate: (() => void) | null = null;

// ============================================================================
// 计算属性
// ============================================================================

type WebCitation = Extract<SearchResultCitation, { sourceType: 'web' }>;
type KnowledgeCitation = Extract<SearchResultCitation, { sourceType: 'knowledge_base' }>;

const webCitation = computed<WebCitation | null>(() => (
  props.citation?.sourceType === 'web' ? props.citation : null
));
const knowledgeCitation = computed<KnowledgeCitation | null>(() => (
  props.citation?.sourceType === 'knowledge_base' ? props.citation : null
));
const isWebCitation = computed(() => webCitation.value !== null);

/** Web 引用的 URL（安全访问） */
const webUrl = computed(() => {
  return webCitation.value?.url ?? '';
});

/** 提取域名用于展示 */
const displayDomain = computed(() => {
  const url = webUrl.value;
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
});

/** Web 引用的发布时间（安全访问） */
const webPublishedAt = computed(() => {
  return webCitation.value?.publishedAt ?? '';
});

/** Web 引用的作者（安全访问） */
const webAuthor = computed(() => {
  return webCitation.value?.author ?? '';
});

/**
 * 引用片段展示文本（用于 Popover）
 *
 * 体验目标：
 * - 让用户明确知道"这是摘录，不是全文"
 * - 默认在前后加上 "..."，并避免重复添加
 */
const displaySnippet = computed(() => {
  const raw = typeof props.citation?.snippet === 'string' ? props.citation.snippet : '';
  const s = raw.trim();
  if (!s) return '';

  // 统一使用 ASCII "..."，避免与某些内容中的中文省略号"……"混用造成视觉噪音
  const prefix = s.startsWith('...') ? '' : '...';
  const suffix = s.endsWith('...') ? '' : '...';
  return `${prefix}${s}${suffix}`;
});

/**
 * 是否有能力计算定位（可见 + DOM 引用齐全）
 */
const canPosition = computed(() => {
  return !!(props.visible && props.triggerElement && popoverRef.value);
});

/**
 * 使用 floating-ui 计算弹窗位置
 *
 * 关键点（修复"离得远/飘"的根因）：
 * - 不再用预估高度，而是让引擎基于真实 DOM 尺寸计算
 * - 使用 autoUpdate：滚动、resize、布局变化时自动更新位置
 * - 支持 flip/shift：视口边缘自动翻转并防溢出
 * - 箭头跟随触发点对齐
 */
async function updatePosition(): Promise<void> {
  if (!props.triggerElement) return;
  if (!popoverRef.value) return;

  const POPUP_WIDTH = 320;
  const VIEWPORT_PADDING = 8;
  const GAP = 8;

  const middleware = [
    floatingOffset(GAP),
    flip({ padding: VIEWPORT_PADDING }),
    shift({ padding: VIEWPORT_PADDING }),
  ];

  // 只有在箭头 DOM 可用时才启用 arrow middleware，避免空引用导致异常
  if (arrowRef.value) {
    middleware.push(floatingArrow({ element: arrowRef.value, padding: 10 }));
  }

  const { x, y, placement, middlewareData } = await computePosition(
    props.triggerElement,
    popoverRef.value,
    {
      // 使用 fixed：与 Teleport 到 body 的 fixed 弹窗一致，且不受祖先滚动容器影响
      strategy: 'fixed',
      // 优先显示在触发点上方；上方空间不足时由 flip 自动翻转到下方
      placement: 'top',
      middleware,
    }
  );

  // placement 为 top* 时，弹窗在触发点上方，箭头应显示在底部；反之在顶部
  arrowPosition.value = placement.startsWith('top') ? 'bottom' : 'top';

  popoverStyle.value = {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: `${POPUP_WIDTH}px`,
  };

  const arrowData = middlewareData.arrow as { x?: number; y?: number } | undefined;
  if (arrowData && typeof arrowData.x === 'number') {
    // arrowData.x 是相对于 popover 左上角的偏移，直接用于 left
    arrowStyle.value = {
      left: `${arrowData.x}px`,
    };
  } else {
    // 箭头计算不到时回退到居中（避免错位太明显）
    arrowStyle.value = { left: '50%', transform: 'translateX(-50%) rotate(45deg)' };
  }
}

function stopAutoUpdate(): void {
  if (cleanupAutoUpdate) {
    cleanupAutoUpdate();
    cleanupAutoUpdate = null;
  }
}

async function startAutoUpdate(): Promise<void> {
  stopAutoUpdate();
  if (!props.triggerElement) return;
  if (!popoverRef.value) return;

  // 首次显示时立刻算一次（确保 Transition/内容变化后位置正确）
  await updatePosition();

  cleanupAutoUpdate = autoUpdate(props.triggerElement, popoverRef.value, () => {
    void updatePosition();
  });
}

// ============================================================================
// 事件处理
// ============================================================================

function handleMouseEnter(): void {
  emit('mouseenter');
}

function handleMouseLeave(): void {
  emit('mouseleave');
}

/** Electron 环境下打开外部链接 */
function handleOpenWebUrl(): void {
  const url = webUrl.value;
  if (url && url.startsWith('http')) {
    void openExternalUrl(url);
  }
}

/**
 * 点击外部关闭
 */
function handleClickOutside(event: MouseEvent): void {
  if (!props.visible) return;

  const target = event.target as HTMLElement;

  // 检查是否点击了弹窗内部
  if (popoverRef.value?.contains(target)) return;

  // 检查是否点击了触发元素
  if (props.triggerElement?.contains(target)) return;

  emit('close');
}

// ============================================================================
// 生命周期
// ============================================================================

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  stopAutoUpdate();
});

// 当 visible 变为 true 时，确保弹窗位置正确
watch(
  () => props.visible,
  async (newVisible) => {
    if (newVisible) {
      await nextTick();
      await startAutoUpdate();
    } else {
      stopAutoUpdate();
    }
  }
);

// 触发元素变化（例如列表重排/虚拟滚动复用节点）时，重建 autoUpdate
watch(
  () => props.triggerElement,
  async () => {
    if (!props.visible) return;
    await nextTick();
    await startAutoUpdate();
  }
);

// 内容变化可能导致高度变化（例如加载 -> 内容），需要重新定位
watch(
  () => [
    props.loading,
    props.error,
    props.citation?.snippet,
    props.citation?.docTitle,
    knowledgeCitation.value?.pageNumber,
  ],
  async () => {
    if (!props.visible) return;
    await nextTick();
    await updatePosition();
  }
);
</script>
