<template>
  <div class="document-list-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.documentList.loading') }}</span>
    </div>

  <!-- 状态：成功 -->
  <div v-else-if="status === 'success'" class="content-container">
    <!-- 头部子标题：统计文档数量 -->
    <div v-if="documents.length > 0" class="header-meta">
      <span class="header-subtitle">
        {{ conversationMessage('conversation.tool.documentList.count', { count: documents.length }) }}
      </span>
    </div>

    <!-- 文档列表 -->
    <div v-if="documents.length > 0" class="doc-list">
        <div 
          v-for="doc in documents" 
          :key="doc.id" 
          class="doc-item"
          :title="`ID: ${doc.id}`"
        >
          <!-- 左侧文件图标 -->
          <div class="doc-icon-wrapper">
            <DocumentIcon class="doc-icon" />
          </div>
          
          <!-- 文档信息 -->
          <div class="doc-info">
            <div class="doc-title">{{ doc.title }}</div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">📂</div>
        <div class="empty-text">{{ conversationMessage('conversation.tool.documentList.empty') }}</div>
      </div>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{{ conversationMessage('conversation.tool.documentList.failed') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { DocumentListPresentationData } from './definitions/documentListPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<DocumentListPresentationData>;
  messageId?: string;
}>();

const { conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);

const documents = computed(() => (
  props.presentation.data.kind === 'snapshot'
    ? props.presentation.data.documents
    : []
));

// 当前文档列表仅用于展示，不提供点击行为
</script>
