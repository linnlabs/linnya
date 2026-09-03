<!-- apps/renderer/features/AiAssistant/ui/message/AnswerMessage.vue -->
<template>
  <div class="answer-body">
    <div class="content-area">
      <MarkstreamRenderer
        :content="message.content"
        :isStreaming="isStreaming"
        :turnId="turnId"
        :citation-dependencies="message.citationDependencies"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AnswerMessage as AnswerMessageModel } from '../../types';
import MarkstreamRenderer from './components/MarkstreamRenderer.vue';

/**
 * 功能 (What): AI答案消息组件，使用 markstream 解析器 + 自研渲染层展示 AI 回答
 * 输入 (Input): message - AI消息对象，isStreaming - 是否正在流式传输（可选）
 * 输出 (Output): 渲染包含实时更新内容块的AI回答
 * 副作用 (Side-effects): 无
 */

interface Props {
  message: AnswerMessageModel;
  isStreaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false
});

/**
 * 从消息元数据中提取 turn_id
 * 用于知识库引用功能
 */
const turnId = computed(() => {
  return props.message.metadata.turn_id;
});
</script>
