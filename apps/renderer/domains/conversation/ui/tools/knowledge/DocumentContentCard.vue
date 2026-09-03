<template>
  <div class="document-content-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.documentContent.loading') }}</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="status === 'success' && content" class="content-container">
      <!-- 卡片外部的 subtitle 区域，结构与 KnowledgeSearchCard 保持一致 -->
      <div class="header-meta">
        <span class="subtitle" :title="`${content.filename} · ${formatRange(content.rangeStart, content.rangeEnd)}`">
          <DocumentIcon class="subtitle-icon" />
          <span class="subtitle-filename">{{ content.filename }}</span>
          <!-- 移除 separator -->
          <span class="subtitle-range">{{ formatRange(content.rangeStart, content.rangeEnd) }}</span>
        </span>
      </div>

      <!-- 内层内容卡片，专注承载可滚动的正文内容 -->
      <div class="content-card">
        <!-- 文档内容展示：限制最大高度，超出时内部滚动 -->
        <div class="doc-content-wrapper">
          <!-- 结构化段落展示 -->
          <div class="chunks-list">
            <div v-for="chunk in content.chunks" :key="chunk.index" class="chunk-item">
              <div class="chunk-gutter">{{ chunk.index }}</div>
              <div class="chunk-text">{{ chunk.text }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{{ conversationMessage('conversation.tool.documentContent.failed') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { DocumentContentPresentationData } from './definitions/documentContentPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<DocumentContentPresentationData>;
  messageId?: string;
}>();

const { conversationMessage } = useConversationLocalization();

const status = computed(() => props.presentation.status);
const content = computed(() => (
  props.presentation.data.kind === 'content' ? props.presentation.data : null
));

function formatRange(start: number, end: number): string {
  if (end !== start) {
    return conversationMessage('conversation.tool.documentContent.paragraphRange', {
      start,
      end,
    });
  }
  return conversationMessage('conversation.tool.documentContent.paragraph', {
    start,
  });
}
</script>
