<template>
  <div class="sharedmemory-doc-write-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.sharedMemory.writeLoading') }}</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="status === 'success'" class="success-state">
      <div class="content-card">
        <div class="info-wrapper">
          <div class="doc-header">
            <span class="doc-name" :title="docName">{{ docName }}</span>
          </div>
          <div class="doc-meta">
            <span class="doc-meta-text" :title="metaText">{{ metaText }}</span>
          </div>
        </div>
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
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { SharedMemoryWritePresentationData } from './definitions/sharedMemoryWritePresentation';

/**
 * 原始 args/result 已由 registry projector 严格校验；组件只消费展示模型。
 */
const props = defineProps<{
  presentation: ToolCardPresentation<SharedMemoryWritePresentationData>;
  messageId?: string;
}>();

const { currentLocale, conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);
const docName = computed(() => data.value.documentName);

/**
 * 写入内容“字数”（中文按字、英文按词）。
 *
 * 字数已在 admission projector 中从正式参数计算，组件不再读取原始 content。
 */
const writeUnits = computed(() => data.value.contentUnits);

/**
 * 引用校验：
 * - 后端工具已强制开启（移除 validate_citations 参数），保证 sharedmemory 文档可回放/可审计。
 * - 因此前端不再展示开关或状态。
 */

const metaText = computed<string>(() => {
  // 中文备注：这里不展示“创建/覆盖/追加”等标签信息，也不暴露文件路径；只给用户一个轻量的变更量提示。
  const units = writeUnits.value ?? 0;
  return conversationMessage('conversation.tool.sharedMemory.updatedUnits', {
    count: Math.max(0, units).toLocaleString(currentLocale.value),
  });
});

const errorMessage = computed(() => {
  return conversationMessage('conversation.tool.sharedMemory.writeFailed');
});
</script>
