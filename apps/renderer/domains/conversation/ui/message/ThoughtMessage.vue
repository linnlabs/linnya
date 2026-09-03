<!-- apps/renderer/features/AiAssistant/ui/message/ThoughtMessage.vue -->
<template>
  <div class="thought-container">
    <div class="thought-header" @click="isThoughtExpanded = !isThoughtExpanded">
      <ChevronIcon 
        :direction="isThoughtExpanded ? 'down' : 'right'" 
        class="thought-arrow"
      />
      <span class="thought-icon">...</span>
      <span class="thought-title">{{ thoughtTitle }}</span>
    </div>
    <div v-if="isThoughtExpanded" class="thought-content-wrapper">
      <div class="thought-content">
        <!-- 说明：思考内容也统一走 markstream 的解析+自研渲染层，避免 v-html/二次后处理带来的不确定性 -->
        <ConversationMarkdownRenderer
          :content="message.content"
          :isStreaming="!isThoughtCompleted"
          :turnId="turnId"
          :citation-dependencies="message.citationDependencies"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import type { ThoughtMessage as ThoughtMessageModel } from '../../types';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import ConversationMarkdownRenderer from './components/stream/ConversationMarkdownRenderer'
import { useConversationLocalization } from '../useConversationLocalization';

interface Props {
  message: ThoughtMessageModel;
}

const props = defineProps<Props>();
const { conversationMessage } = useConversationLocalization();

/**
 * 中文备注：
 * - Thought 消息里同样可能出现 [@ref]；引用事实随当前消息 dependency snapshot 传入，
 *   不允许组件再跨消息扫描全局注册表。
 */
const turnId = computed(() => {
  return props.message.metadata.turn_id;
});

// State
const isThoughtExpanded = ref(true);
const currentTime = ref(Date.now());
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null);

// 计算思考是否完成（方案B：只依赖 thought 自身的元数据锚点，禁止耦合 task_*）
const isThoughtCompleted = computed(() => {
  return props.message.metadata.is_complete;
});

// 计算思考时长（秒）
const thinkingDuration = computed(() => {
  // 起点：优先使用 thought 的不可变起始锚点
  const meta = props.message.metadata;
  const startTime = meta.thought_started_at;
  const isCompleted = meta.is_complete;
  const endTime = isCompleted ? meta.thought_completed_at : currentTime.value;

  let duration = Math.max(0, Math.floor((endTime - startTime) / 1000));
  // 体验优化：完成态且有正差值但取整为0时，最少显示1秒
  if (isCompleted && endTime > startTime && duration === 0) {
    duration = 1;
  }
  
  return duration;
});

// 格式化时间显示
const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return conversationMessage('conversation.thought.duration.seconds', { seconds });
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return conversationMessage('conversation.thought.duration.minutesSeconds', {
    minutes,
    seconds: remainingSeconds,
  });
};

// 动态思考标题
const thoughtTitle = computed(() => {
  if (isThoughtCompleted.value) {
    return conversationMessage('conversation.thought.completed', {
      duration: formatDuration(thinkingDuration.value),
    });
  }
  return conversationMessage('conversation.thought.running');
});

// 生命周期管理
onMounted(() => {
  // 如果思考未完成，启动定时器更新时间
  if (!isThoughtCompleted.value) {
    timerInterval.value = setInterval(() => {
      currentTime.value = Date.now();
    }, 1000); // 每秒更新一次
  }
});

onUnmounted(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value);
  }
});

// 监听思考完成状态，完成后停止计时器并自动折叠
watch(
  isThoughtCompleted,
  (completed) => {
    if (completed) {
      if (timerInterval.value) {
        clearInterval(timerInterval.value);
        timerInterval.value = null;
      }
      isThoughtExpanded.value = false;
    }
  },
  { immediate: true }
);
</script>
