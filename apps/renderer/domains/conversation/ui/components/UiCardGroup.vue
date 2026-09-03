<template>
  <UiCardGroupHeader
    ref="cardGroupShellRef"
    :header="header"
    :is-expanded="isExpanded"
    :is-active="isActive"
    :has-next="hasNext"
    @toggle="toggle"
  >
      <!--
        bounded 子任务位于 virtualizer 的单个动态 row 内，本身没有展开动画产品语义。
        参考 08-lifecycle：这里必须结构性绕开 BaseTransition，不能仅把 CSS/hook 设为 no-op；
        否则 async SubrunCard 更新时仍会参与 Transition 锚点生命周期并可能留下 null subTree.el。
      -->
      <UiCardGroupBody
        v-if="bounded && isExpanded"
        v-bind="bodyBindings"
        @show-all="showAllChildren = true"
        @copy="copyGroupAnswers"
        @save="saveAsDocument"
        @actions-mouseenter="handleMouseEnterActions"
        @edit-message="$emit('edit-message', $event)"
        @regenerate-response="$emit('regenerate-response', $event)"
      >
        <template #empty><slot name="empty" /></template>
      </UiCardGroupBody>
      <Transition
        v-else
        name="ui-card-group-expand"
        @enter="onEnter"
        @after-enter="onAfterEnter"
        @leave="onLeave"
      >
        <UiCardGroupBody
          v-if="isExpanded"
          v-bind="bodyBindings"
          @show-all="showAllChildren = true"
          @copy="copyGroupAnswers"
          @save="saveAsDocument"
          @actions-mouseenter="handleMouseEnterActions"
          @edit-message="$emit('edit-message', $event)"
          @regenerate-response="$emit('regenerate-response', $event)"
        >
          <template #empty><slot name="empty" /></template>
        </UiCardGroupBody>
      </Transition>
  </UiCardGroupHeader>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { BaseMessage } from '../../types';
import type { ConversationCardGroupHeader } from '../../definitions/conversationPresentation';
import UiCardGroupHeader from './UiCardGroupHeader.vue';
import UiCardGroupBody from './UiCardGroupBody.vue';
import { findCitationInMessages } from '../../features/citation-presentation';
import {
  copyRenderedAnswersToClipboard,
  exportRenderedAnswersAsDocument,
} from '../tools/knowledge/clipboard/richClipboardActions';
import { useConversationLocalization } from '../useConversationLocalization';
import type { ConversationMessageKey } from '../../definitions/conversationMessages';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../definitions/userMessageContent';

interface Props {
  /**
   * subrun 卡片头。
   *
   * 约定：
   * - run 头已改为 UserMessage（user_input），不再用 UiCardGroup；
   * - UiCardGroup 仅用于逐步过程，不承担父 run 头展示。
   */
  header: ConversationCardGroupHeader;
  children: BaseMessage[];
  isStreaming?: boolean;
  isActive?: boolean;
  /** 是否需要显示向下连接线（取决于下一个兄弟元素是否也是卡片） */
  hasNext?: boolean;
  /**
   * 窗口化渲染阈值（仅渲染最近 N 条子消息）
   *
   * 中文说明：
   * - 这个参数用于解决“超长任务展开后渲染越来越卡”的根因问题；
   * - 默认 undefined：保持历史行为（渲染全部）；
   * - 推荐值：60~120（既能看到实时进展，又能控制 DOM 规模）。
   */
  maxVisibleChildren?: number;
  /** 动态子过程嵌套在单个虚拟 row 内时，用内部滚动约束外层几何。 */
  bounded?: boolean;
  /** collection 可选受控态；不传时继续使用组件原有的本地展开状态。 */
  expansionState?: 'expanded' | 'collapsed';
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  isActive: false,
  hasNext: false,
  maxVisibleChildren: undefined,
  bounded: false,
  expansionState: undefined,
});

const emit = defineEmits<{
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
  'expanded': [];
  'expanded-change': [expanded: boolean];
}>();
const { conversationMessage } = useConversationLocalization();

// 容器引用：用于从“已渲染 DOM”里抽取回答区 HTML（保证表格/列表结构）
const cardGroupShellRef = ref<{ rootElement: HTMLElement | null } | null>(null);

const collapsedByDefault = computed(() => {
  return props.header.collapsedByDefault;
});

const localIsExpanded = ref(!collapsedByDefault.value);
const isExpanded = computed(() => (
  props.expansionState === undefined
    ? localIsExpanded.value
    : props.expansionState === 'expanded'
));
const showAllChildren = ref(false);

// 当 children 被重置（回放/切换）时，重置“显示全部”状态，避免把上一次的 UI 状态带入下一次
watch(
  () => props.header.id,
  () => {
    showAllChildren.value = false;
  }
);

watch(
  () => props.children.length,
  (len, prevLen) => {
    // 长度回退通常意味着回放/重置：恢复窗口化状态
    if (typeof prevLen === 'number' && len < prevLen) {
      showAllChildren.value = false;
    }
  }
);

const visibleChildren = computed(() => {
  const max = props.maxVisibleChildren;
  if (showAllChildren.value) return props.children;
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return props.children;
  const total = props.children.length;
  if (total <= max) return props.children;
  return props.children.slice(total - max);
});

const omittedCount = computed(() => {
  const total = props.children.length;
  const visible = visibleChildren.value.length;
  return total > visible ? total - visible : 0;
});

// 抽取渲染 HTML / 复制 / 导出 的核心逻辑已下沉到公共工具（richClipboardActions.ts）

/**
 * 计算本卡片“可见范围内”的回答内容（与窗口化渲染保持一致）。
 * - 若用户希望复制/导出完整历史，应先点击“显示全部”再操作。
 */
const groupAnswerContent = computed(() => {
  const answerMessages = visibleChildren.value.filter((msg) => msg.type === 'final_answer');
  return answerMessages.map((msg) => msg.content).join('\n\n');
});

/**
 * 推导一个“日志用 turnId”：
 * - 优先读消息 metadata.turn_id（投影系统/子任务派生消息会注入该字段）；
 * - 如果缺失，则回退到 header.id，仅用于日志定位（引用水合依赖的是 DOM 上的 data-turn-id）。
 */
const loggingTurnId = computed(() => {
  for (const m of visibleChildren.value) {
    const v = m.metadata?.['turn_id'];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return props.header.id;
});

const shouldShowActions = computed(() => {
  // 轮次完成操作只在非流式状态且存在回答内容时显示。
  return !props.isStreaming && groupAnswerContent.value.trim().length > 0;
});

const bodyBindings = computed(() => ({
  visibleChildren: visibleChildren.value,
  omittedCount: omittedCount.value,
  isStreaming: props.isStreaming,
  bounded: props.bounded,
  showActions: shouldShowActions.value,
  savedStatusText: savedStatusText.value,
  showCopiedText: showCopiedText.value,
  showSavedText: showSavedText.value,
  isSaving: isSavingAsDocument.value,
}));

// 复制按钮状态
const showCopiedText = ref(false);
let copiedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

// 另存为文档按钮状态
const isSavingAsDocument = ref(false);
const showSavedText = ref(false);
let savedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
type SaveStatus = 'saved' | 'saving' | 'empty' | 'failed';
const SAVE_STATUS_MESSAGE_KEYS: Readonly<Record<SaveStatus, ConversationMessageKey>> = {
  saved: 'conversation.turn.saveStatus.saved',
  saving: 'conversation.turn.saveStatus.saving',
  empty: 'conversation.turn.saveStatus.empty',
  failed: 'conversation.turn.saveStatus.failed',
};
const savedStatus = ref<SaveStatus>('saved');
const savedStatusText = computed(() => {
  return conversationMessage(SAVE_STATUS_MESSAGE_KEYS[savedStatus.value]);
});

function handleMouseEnterActions(): void {
  showCopiedText.value = false;
  showSavedText.value = false;
}

function scheduleCopiedFeedbackReset(): void {
  if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
  copiedFeedbackTimer = setTimeout(() => {
    showCopiedText.value = false;
    copiedFeedbackTimer = null;
  }, 2000);
}

function scheduleSavedFeedbackReset(delayMs: number): void {
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
  savedFeedbackTimer = setTimeout(() => {
    showSavedText.value = false;
    savedFeedbackTimer = null;
  }, delayMs);
}

/**
 * 复制本卡片的回答内容到剪贴板（优先写入 text/html + text/plain，保证表格结构）
 */
const copyGroupAnswers = async (): Promise<void> => {
  try {
    const content = groupAnswerContent.value;
    if (!content.trim()) {
      console.warn('[UiCardGroup] 没有可复制的回答内容', { headerId: props.header.id });
      return;
    }

    const copyResult = await copyRenderedAnswersToClipboard({
      containerEl: cardGroupShellRef.value?.rootElement ?? null,
      plainText: content,
      copyScope: 'card-answer',
      findCitationByRef: (turnId, ref) => (
        findCitationInMessages(visibleChildren.value, turnId, ref)
      ),
      generateCitationId: () => crypto.randomUUID(),
      conversationMessage,
    });

    if (!copyResult.success) {
      console.error('[UiCardGroup] 复制失败:', copyResult.error);
      return;
    }

    if (copyResult.hydrationStats) {
      console.log('[UiCardGroup][复制] 引用水合统计', {
        turnId: loggingTurnId.value,
        识别到的引用节点: copyResult.hydrationStats.total,
        成功水合: copyResult.hydrationStats.hydrated,
        失败数量: copyResult.hydrationStats.missing.length,
      });

      if (copyResult.hydrationStats.missing.length > 0) {
        console.warn('[UiCardGroup][复制] 以下引用未能水合（元数据缺失）:', copyResult.hydrationStats.missing);
      }
    }

    showCopiedText.value = true;
    scheduleCopiedFeedbackReset();
  } catch (err) {
    console.error('[UiCardGroup] 复制失败:', err);
  }
};

/**
 * 将本卡片回答内容另存为工作区文档（复用 conversation 回答导出链路）
 */
const saveAsDocument = async (): Promise<void> => {
  if (isSavingAsDocument.value) return;

  try {
    isSavingAsDocument.value = true;
    savedStatus.value = 'saving';
    showSavedText.value = true;

    const content = groupAnswerContent.value;
    if (!content.trim()) {
      console.warn('[UiCardGroup] 没有可保存的回答内容', { headerId: props.header.id });
      savedStatus.value = 'empty';
      scheduleSavedFeedbackReset(2000);
      return;
    }

    const result = await exportRenderedAnswersAsDocument({
      containerEl: cardGroupShellRef.value?.rootElement ?? null,
      plainText: content,
      copyScope: 'card-answer',
      findCitationByRef: (turnId, ref) => (
        findCitationInMessages(visibleChildren.value, turnId, ref)
      ),
      generateCitationId: () => crypto.randomUUID(),
      conversationMessage,
    });

    if (result.success) {
      savedStatus.value = 'saved';
      console.log('[UiCardGroup] 另存为文档成功', {
        documentId: result.documentId,
        hydrationStats: result.hydrationStats,
      });

      if (result.hydrationStats && result.hydrationStats.missing.length > 0) {
        console.warn('[UiCardGroup] 部分引用未能水合:', result.hydrationStats.missing);
      }

      scheduleSavedFeedbackReset(2000);
    } else {
      savedStatus.value = 'failed';
      console.error('[UiCardGroup] 另存为文档失败:', result.error);
      scheduleSavedFeedbackReset(3000);
    }
  } catch (err) {
    console.error('[UiCardGroup] 另存为文档异常:', err);
    savedStatus.value = 'failed';
    scheduleSavedFeedbackReset(3000);
  } finally {
    isSavingAsDocument.value = false;
  }
};

onUnmounted(() => {
  if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
});

const toggle = () => {
  const nextExpanded = !isExpanded.value;
  if (props.expansionState === undefined) {
    localIsExpanded.value = nextExpanded;
  }
  emit('expanded-change', nextExpanded);
  if (nextExpanded) {
    emit('expanded');
  }
};

const onEnter = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = '0';
  element.style.opacity = '0';
  // 强制重绘后再过渡到内容高度。
  // eslint-disable-next-line no-unused-expressions
  element.offsetHeight;
  element.style.height = `${element.scrollHeight}px`;
  element.style.opacity = '1';
};

const onAfterEnter = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = 'auto';
  element.style.opacity = '';
};

const onLeave = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = `${element.scrollHeight}px`;
  element.style.opacity = '1';
  // 强制重绘后再过渡到折叠态。
  // eslint-disable-next-line no-unused-expressions
  element.offsetHeight;
  element.style.height = '0';
  element.style.opacity = '0';
};

</script>
