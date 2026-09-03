<!-- apps/renderer/domains/conversation/ui/message/UserMessage.vue -->
<template>
  <div class="user-message-container" ref="userMessageContainerRef">
    <!-- 显示模式 -->
    <div v-if="!isEditing" class="display-mode">
      <div class="message-bubble">
        <!--
          中文备注：
          - 引用内容来自事件库的 `message.metadata.user_quote`（snake_case）；
          - 脚本侧不再暴露 `userQuote` 变量，避免 camelCase/snake_case 口径不一致。
          - 这里用 quoteList 判空即可（quoteList 已过滤无展示内容的条目）。
        -->
        <div v-if="quoteList.length" class="quote-section">
          <div 
            v-for="quote in quoteList"
            :key="quote.item.quote_id"
            class="quote-block"
          >
            <div class="quote-content">
              {{ quote.displayText }}
            </div>
          </div>
        </div>
        <ConversationImageAttachmentGallery :attachments="message.attachments ?? []" />
        <!--
          ⚠️ 重要：不要在这里用 {{ }} 并保持缩进换行。
          原因：.message-bubble 使用了 white-space: pre-wrap，
          模板里的缩进/换行会被编译为真实的文本节点，从而在内容前渲染出“一个空格/空白”。
          这里用 v-text，避免产生多余的空白文本节点。
        -->
        <span class="message-content" v-text="message.content"></span>
      </div>
      <div class="user-message-actions">
        <span
          v-if="formattedTimestamp"
          class="user-message-timestamp"
          :title="timestampTitle"
        >
          {{ formattedTimestamp }}
        </span>
        <div class="user-message-action-buttons">
          <button
            v-if="!isActivityMessage"
            class="action-button"
            :title="conversationMessage('conversation.userMessage.action.edit')"
            @click="startEditing"
          >
            <EditIcon />
          </button>
          <button
            v-if="!isActivityMessage"
            class="action-button"
            :title="conversationMessage('conversation.userMessage.action.regenerate')"
            @click="handleRegenerate"
          >
            <RefreshIcon />
          </button>
          <button
            class="action-button user-message-copy-button"
            :title="conversationMessage('conversation.userMessage.action.copy')"
            @click="copyMessage"
          >
            <!--
              复制反馈必须只更新原生节点属性。消息位于虚拟列表中，若把 v-show
              直接挂到图标组件，Vue 的优化 block 会让组件根 vnode 参与指令 patch，
              虚拟行更新交错时可能拿到已经失效的 DOM 引用。
            -->
            <span
              class="copy-feedback-icon"
              :hidden="showCopiedText"
            >
              <CopyIcon />
            </span>
            <span
              class="copied-text"
              :hidden="!showCopiedText"
            >
              {{ conversationMessage('conversation.userMessage.action.copied') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑模式 -->
    <div v-else class="edit-mode">
      <div class="edit-input-wrapper">
        <!-- 引用标签展示：与 AiAssistantInput 的标签风格保持一致 -->
        <div v-if="quoteList.length" class="edit-quote-preview">
          <div class="edit-quote-preview-header">
            <span class="edit-quote-label">
              {{ conversationMessage('conversation.userMessage.quoteLabel') }}
            </span>
          </div>
          <div class="edit-quote-preview-body">
            <div class="edit-quote-list">
              <div
                v-for="quote in quoteList"
                :key="quote.item.quote_id"
                class="edit-quote-pill"
              >
                <span class="edit-quote-pill-text">{{ quote.displayText }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 上栏：文本输入区域 -->
        <div class="edit-top-section">
          <ConversationImageAttachmentEditor :disabled="isEditSubmitting" />
          <textarea
            ref="textareaRef"
            v-model="editedContent"
            class="edit-textarea"
            :disabled="isEditSubmitting"
            @input="adjustTextareaHeight"
            @keydown.enter.exact.prevent="saveEdit"
            @keydown.esc.prevent="cancelEdit"
          ></textarea>
        </div>
        
        <!-- 下栏：编辑按钮 -->
        <div class="edit-bottom-section">
          <div class="edit-actions">
            <button
              class="edit-button cancel"
              :disabled="isEditSubmitting"
              @click="cancelEdit"
              :title="conversationMessage('conversation.userMessage.action.cancel')"
            >
              <CloseIcon />
            </button>
            <button
              class="edit-button save"
              :disabled="isEditSubmitting"
              @click="saveEdit"
              :title="conversationMessage('conversation.userMessage.action.save')"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 10 4 15 9 20"></polyline>
                <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onUnmounted, watch, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import type { UserMessage as UserMessageModel } from '../../types';
import { EditIcon } from '@linnya/renderer-ui/icons';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import {
  formatUserMessageTimestamp,
  formatUserMessageTimestampTitle,
} from '../../functions/userMessageTimestamp';
import { useConversationLocalization } from '../useConversationLocalization';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';
import { buildUserMessageQuoteDisplay } from '../../functions/userMessageQuoteDisplay';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../definitions/userMessageContent';
import {
  ConversationImageAttachmentEditor,
  ConversationImageAttachmentGallery,
  hasConversationImageSelectionChanged,
  useConversationImageEditSession,
} from '../../features/image-attachments';

/**
 * @file apps/renderer/domains/conversation/ui/message/UserMessage.vue
 * @description 用户消息组件，支持原地编辑、重新生成和复制功能
 */

interface Props {
  message: UserMessageModel;
}

const props = defineProps<Props>();
const { currentLocale, conversationMessage } = useConversationLocalization();

const emit = defineEmits<{
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const showCopiedText = ref(false);
let copiedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
const isEditing = ref(false);
const editedContent = ref('');
const userMessageContainerRef = ref(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const { store: imageEditStore, controller: imageEditController } = useConversationImageEditSession();
const isEditSubmitting = computed(() => (
  imageEditStore.messageId === props.message.id && imageEditStore.isSubmitting
));

const quoteList = computed(() => {
  return (props.message.metadata?.user_quote?.items ?? [])
    .map(buildUserMessageQuoteDisplay)
    .filter(quote => quote !== undefined);
});

const isActivityMessage = computed(() => {
  return !!props.message.metadata?.activity;
});

const formattedTimestamp = computed(() => formatUserMessageTimestamp(
  props.message.timestamp,
  new Date(),
  currentLocale.value,
));
const timestampTitle = computed(() => formatUserMessageTimestampTitle(props.message.timestamp));

// 点击外部区域取消编辑
onClickOutside(userMessageContainerRef, () => {
  if (isEditing.value) {
    cancelEdit();
  }
});

/**
 * 功能 (What): 调整文本框高度以适应内容
 * 优化：使用 scrollbar-gutter 避免滚动条闪烁
 */
const adjustTextareaHeight = () => {
  if (!textareaRef.value) return;
  applyTextareaAutoResize(textareaRef.value, { maxHeight: 240 });
};

// 监听输入内容变化，自动调整高度
watch(editedContent, () => {
  nextTick(adjustTextareaHeight);
});

/**
 * 功能 (What): 开始编辑消息
 */
const startEditing = async () => {
  if (!imageEditController.start(props.message.id, props.message.attachments ?? [])) return;
  isEditing.value = true;
  editedContent.value = props.message.content;
  await nextTick();
  textareaRef.value?.focus();
  adjustTextareaHeight(); // 打开时立即调整一次高度
};

/**
 * 功能 (What): 取消编辑
 */
const cancelEdit = () => {
  imageEditController.cancel(props.message.id);
  isEditing.value = false;
};

/**
 * 功能 (What): 保存编辑后的消息
 */
const saveEdit = () => {
  const submission = imageEditController.beginSubmission(props.message.id);
  if (!submission) return;
  const hasText = editedContent.value.trim().length > 0;
  const attachmentChanged = hasConversationImageSelectionChanged(imageEditStore, submission.selection);
  if (hasText || submission.selection.items.length > 0) {
    if (editedContent.value === props.message.content && !attachmentChanged) {
      imageEditController.failSubmission(props.message.id);
      cancelEdit();
      return;
    }
    emit('edit-message', {
      messageId: props.message.id,
      text: editedContent.value,
      attachmentSelection: submission.selection,
    });
    return;
  }
  imageEditController.failSubmission(props.message.id);
};

watch(() => imageEditStore.messageId, messageId => {
  if (isEditing.value && messageId !== props.message.id) isEditing.value = false;
});

/**
 * 功能 (What): 触发重新生成回答事件
 */
const handleRegenerate = () => {
  emit('regenerate-response', { messageId: props.message.id });
};

/**
 * 功能 (What): 复制消息内容到剪贴板
 */
const copyMessage = async () => {
  try {
    await navigator.clipboard.writeText(props.message.content);
    showCopiedText.value = true;
    if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
    copiedFeedbackTimer = setTimeout(() => {
      showCopiedText.value = false;
      copiedFeedbackTimer = null;
    }, 2000);
  } catch (err) {
    console.error('复制失败:', err);
  }
};

onUnmounted(() => {
  if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
});
</script>
