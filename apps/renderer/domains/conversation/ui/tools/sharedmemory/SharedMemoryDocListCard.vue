<template>
  <div class="sharedmemory-doc-list-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.sharedMemory.listLoading') }}</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="status === 'success'" class="content-container">
      <!-- 头部子标题：统计文档数量 -->
      <div class="header-meta">
        <span class="header-subtitle">
          {{ conversationMessage('conversation.tool.sharedMemory.listCount', { count: docs.length }) }}
        </span>
      </div>

      <!-- 文档列表 -->
      <div v-if="docs.length > 0" class="doc-list">
        <div
          v-for="d in docs"
          :key="d.name"
          class="doc-item"
          :title="d.fullTitle"
        >
          <div class="doc-icon-wrapper">
            <DocumentIcon class="doc-icon" />
          </div>

          <div class="doc-info">
            <div class="doc-title">{{ d.name }}</div>
            <div class="doc-meta">
              <span class="doc-size">{{ d.sizeText }}</span>
              <span class="dot">·</span>
              <span class="doc-time">{{ d.updatedAtText }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-text">{{ conversationMessage('conversation.tool.sharedMemory.listEmpty') }}</div>
      </div>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{{ errorMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { SharedMemoryListPresentationData } from './definitions/sharedMemoryListPresentation';

/**
 * 原始 list/resource_list payload 已由 registry projector 严格校验并归一。
 * 卡片只负责本地化、时间与字节格式化。
 */
const props = defineProps<{
  presentation: ToolCardPresentation<SharedMemoryListPresentationData>;
  messageId?: string;
}>();

const { currentLocale, conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const dt = new Date(ms);
  // 中文备注：只做 UI 展示，不做时区推断；交给浏览器/系统 locale。
  return new Intl.DateTimeFormat(currentLocale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

const docs = computed(() => {
  const documents = data.value.kind === 'snapshot' ? data.value.documents : [];
  return documents.map((document) => {
    const sizeText = formatBytes(document.sizeBytes);
    const updatedAtText = formatTime(document.updatedAtMs);
    return {
      name: document.name,
      sizeText,
      updatedAtText,
      fullTitle: [
        document.name,
        conversationMessage('conversation.tool.sharedMemory.listTitleSize', { size: sizeText }),
        conversationMessage('conversation.tool.sharedMemory.listTitleUpdatedAt', { time: updatedAtText }),
      ].join('\n'),
    };
  });
});

const errorMessage = computed(() => {
  return conversationMessage('conversation.tool.sharedMemory.listFailed');
});
</script>
