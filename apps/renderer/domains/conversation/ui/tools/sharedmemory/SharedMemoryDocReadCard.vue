<template>
  <div class="sharedmemory-doc-read-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner" />
      <span>{{ loadingText }}</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="status === 'success'" class="content-container">
      <!-- subtitle：文档名 + 字符数 -->
      <div class="header-meta">
        <span class="subtitle" :title="`${headerName} · ${sizeText}`">
          <span class="subtitle-filename">{{ headerName }}</span>
          <span class="subtitle-range">{{ sizeText }}</span>
        </span>
      </div>

      <!-- 内容卡片：可滚动正文 -->
      <div class="content-card">
        <div class="doc-content-wrapper">
          <!--
            收敛：取消子组件（Markdown 渲染器）。
            中文备注：这里直接展示纯文本，避免引入额外渲染链路；需要富文本时可恢复 MarkstreamRenderer。
          -->
          <!-- <MarkstreamRenderer :content="markdownBody" :isStreaming="false" /> -->
          <pre class="doc-plain">{{ markdownBody }}</pre>
        </div>
      </div>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { ConversationArtifactReadPresentationData } from './definitions/conversationArtifactReadPresentation';

/**
 * 历史 SharedMemory / conversation-scoped Resource 事件的展示卡片。
 * 原始 payload 已由 registry projector 严格校验；组件只消费判别后的展示模型。
 */
/**
 * SharedMemory 文档统一展示名：
 * - 这套工具面向“临时 Markdown 文档”，最终落盘永远是 .md；
 * - 若 doc_name 已带扩展名（如 config.json），展示为 config.json.md，避免用户误以为是 json 文件本体。
 */
function ensureMdSuffix(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return n.toLowerCase().endsWith('.md') ? n : `${n}.md`;
}

const props = defineProps<{
  presentation: ToolCardPresentation<ConversationArtifactReadPresentationData>;
  messageId?: string;
}>();

const { currentLocale, conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);

const headerName = computed(() => {
  if (data.value.kind !== 'snapshot') return '';
  const artifact = data.value.artifact;
  return artifact.source === 'shared_memory'
    ? ensureMdSuffix(artifact.doc_name)
    : artifact.bundle_id;
});

const sizeText = computed(() => {
  const sizeChars = data.value.kind === 'snapshot' ? data.value.artifact.size_chars : 0;
  return conversationMessage('conversation.tool.sharedMemory.sizeCharacters', {
    count: sizeChars.toLocaleString(currentLocale.value),
  });
});

const loadingText = computed(() => {
  if (!data.value.source) return conversationMessage('conversation.tool.sharedMemory.read');
  if (data.value.source === 'shared_memory')
    return conversationMessage('conversation.tool.sharedMemory.readSharedMemoryLoading');
  if (data.value.source === 'evidence')
    return conversationMessage('conversation.tool.sharedMemory.readEvidenceLoading');
  return conversationMessage('conversation.tool.sharedMemory.readCitationSnapshotLoading');
});

const markdownBody = computed(() =>
  data.value.kind === 'snapshot' ? data.value.artifact.content : ''
);

const errorMessage = computed(() => {
  if (!data.value.source) return conversationMessage('conversation.tool.sharedMemory.read');
  if (data.value.source === 'shared_memory')
    return conversationMessage('conversation.tool.sharedMemory.readSharedMemoryFailed');
  if (data.value.source === 'evidence')
    return conversationMessage('conversation.tool.sharedMemory.readEvidenceFailed');
  return conversationMessage('conversation.tool.sharedMemory.readCitationSnapshotFailed');
});
</script>
