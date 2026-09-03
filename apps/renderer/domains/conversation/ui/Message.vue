<!-- apps/renderer/features/AiAssistant/ui/Message.vue -->
<template>
  <div
    v-if="shouldRenderMessage"
    ref="root"
    class="ai-message"
    :class="messageClasses"
    :data-conversation-message-id="messageId"
  >
    
    <!-- 用户消息 -->
    <UserMessage 
      v-if="message.type === 'user_input'" 
      :message="message" 
      @edit-message="handleEditMessage"
      @regenerate-response="handleRegenerateResponse"
    />

    <!-- 历史摘要消息 -->
    <SummaryMessageComponent
      v-else-if="message.type === 'history_summary' || message.type === 'summarization_progress'"
      :message="message"
    />

    <!-- AI 助理消息 -->
    <div v-else class="message-role-assistant">
      
      <!-- 思考内容 -->
      <ThoughtMessage 
        v-if="message.type === 'thought'" 
        :message="message" 
      />
      
      <!-- 工具执行（新的统一工具展示） -->
      <ToolCallsMessage 
        v-else-if="message.type === 'tool_calls'" 
        :message="message" 
      />
      
      <!-- 最终答案/普通回答 -->
      <AnswerMessage 
        v-else-if="shouldRenderAnswerMessage" 
        :message="message" 
        :isStreaming="isStreaming"
      />
      
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, onMounted } from 'vue';
import type { BaseMessage } from '../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../definitions/userMessageContent';
import { shouldRenderConversationMessage } from '../functions/renderableConversationMessage';
import { MESSAGE_ENTRY_ANIMATION_PORT_KEY } from '../definitions/messageEntryAnimation';

// 导入子组件
import UserMessage from './message/UserMessage.vue';
import ThoughtMessage from './message/ThoughtMessage.vue';
import AnswerMessage from './message/AnswerMessage.vue';
import ToolCallsMessage from './message/ToolCallsMessage.vue';
import SummaryMessageComponent from './message/SummaryMessage.vue';

/**
 * 功能 (What): 统一消息组件，根据消息类型渲染对应的子组件
 * 输入 (Input): message - 消息对象，isStreaming - 是否正在流式传输（可选）
 * 输出 (Output): 渲染对应类型的消息组件
 * 副作用 (Side-effects): 向上冒泡用户消息的'编辑'和'重新生成'事件
 */

// Props
interface Props {
  message: BaseMessage;
  isStreaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false
});

// Emits
const emit = defineEmits<{
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const messageEntryAnimationPort = inject(MESSAGE_ENTRY_ANIMATION_PORT_KEY);
if (!messageEntryAnimationPort) {
  throw new Error('MessageEntryAnimationPort 未装配：Message 必须由 Conversation render host 提供动画端口');
}

const root = ref<HTMLElement | null>(null);
const messageId = computed(() => props.message.id);

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
};

const shouldAnimateEntryOnMount = messageEntryAnimationPort.isPending(messageId.value);
const animationClass = ref(
  shouldAnimateEntryOnMount && !prefersReducedMotion() ? 'animate-in' : 'no-animation'
);

onMounted(() => {
  if (!shouldAnimateEntryOnMount) {
    return;
  }

  messageEntryAnimationPort.consume(messageId.value);

  if (animationClass.value === 'animate-in' && root.value) {
    root.value.addEventListener('animationend', () => {
      animationClass.value = 'no-animation';
    }, { once: true });
  }
});

const handleEditMessage = (command: EditUserMessageCommand) => {
  emit('edit-message', command);
};

/**
 * 功能 (What): 处理并冒泡用户的'重新生成'事件
 * 输入 (Input): message - 从UserMessage组件传来的消息对象
 * 输出 (Output): 无
 * 副作用 (Side-effects): 发射 'regenerate-response' 事件，让上层组件处理业务逻辑
 */
const handleRegenerateResponse = (command: RegenerateUserMessageCommand) => {
  emit('regenerate-response', command);
};

// 计算属性
const messageClasses = computed(() => [
  `message-role-${props.message.role}`,
  `message-type-${props.message.type}`,
  animationClass.value
]);

// 可见性判定收口在 functions/renderableConversationMessage.ts
const shouldRenderMessage = computed(() => shouldRenderConversationMessage(props.message));

// 工具前播报与中断段仍是可见 assistant 文本，但不具备终态交付语义。
const shouldRenderAnswerMessage = computed(() => (
  props.message.type === 'final_answer'
  || props.message.type === 'tool_preamble'
  || props.message.type === 'partial_answer'
));
</script>
