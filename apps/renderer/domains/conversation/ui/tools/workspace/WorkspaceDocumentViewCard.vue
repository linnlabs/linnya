<template>
  <div class="workspace-document-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.workspace.document.readLoading') }}</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="status === 'success' && snapshot && documentPresentation" class="content-container">
      <!-- 头部 subtitle：左侧文件名 + 图标，右侧段落范围 -->
      <div class="header-meta">
        <span class="subtitle" :title="rangeLabel ? `${documentName} · ${rangeLabel}` : documentName">
          <component :is="subtitleIconComponent" class="subtitle-icon" />
          <span class="subtitle-filename">{{ documentName }}</span>
          <span v-if="rangeLabel" class="subtitle-range">{{ rangeLabel }}</span>
        </span>
      </div>

      <!-- 内层内容卡片：承载可滚动的 DocumentView 正文 -->
      <div class="content-card">
        <div class="doc-content-wrapper">
          <!-- Outline：渲染插件声明的结构化大纲，不展示内部引用协议。 -->
          <div v-if="documentPresentation.kind === 'outline' && documentPresentation.items.length > 0" class="document-outline">
            <div
              v-for="item in documentPresentation.items"
              :key="item.id"
              class="document-outline-row"
              :style="{ paddingLeft: `${item.depth * 14}px` }"
            >
              {{ item.text }}
            </div>
          </div>

          <!-- Markdown：使用解析后的 blocks 渲染行号 + 正文 -->
          <div v-else-if="documentPresentation.kind === 'blocks' && blocks.length > 0" class="blocks-list">
            <div
              v-for="block in blocks"
              :key="block.id"
              class="block-item"
            >
              <div class="block-gutter">{{ block.ordinal }}</div>
              <div class="block-text">
                <MarkstreamRenderer :content="block.text" :is-streaming="false" />
              </div>
            </div>
          </div>

          <div v-else-if="documentPresentation.kind === 'text'" class="raw-content">
            <pre class="content-text">{{ documentPresentation.text }}</pre>
          </div>

          <div v-else class="raw-content">
            <span class="content-text">{{ emptyPresentationText }}</span>
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
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useDocumentTypeByNodeType } from '@/app/plugins/composables';
import MarkstreamRenderer from '../../message/components/MarkstreamRenderer.vue';
import type { WorkspaceDocumentReadBlock } from '@app/schemas';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { WorkspaceDocumentViewPresentationData } from './definitions/workspaceDocumentViewPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<WorkspaceDocumentViewPresentationData>;
}>();

const { conversationMessage } = useConversationLocalization();

const status = computed(() => props.presentation.status);
const snapshot = computed(() => (
  props.presentation.data.kind === 'snapshot' ? props.presentation.data.document : null
));
const documentPresentation = computed(() => snapshot.value?.presentation ?? null);
const docType = computed(() => snapshot.value?.docType);

const resolvedNodeType = computed(() => (
  docType.value === 'markdown' ? 'document' : docType.value
));
const resolvedDocumentType = useDocumentTypeByNodeType(resolvedNodeType);
const subtitleIconComponent = computed(() => {
  return resolvedDocumentType.value?.iconComponent ?? DocumentIcon;
});
const documentName = computed(() => snapshot.value?.documentName ?? '');

/**
 * Workspace 文档“空块”展示：
 * - Phase 7 的 insert 会先创建空 rootBlock，再通过 pending revision 写入 markdown；
 * - 因此在 view_mode=base 时，某些块可能是空字符串；
 * - 为避免用户误以为“插入没成功”，UI 对空文本显示占位符。
 */
function formatBlockText(text: string): string {
  return text.trim().length > 0 ? text : conversationMessage('conversation.tool.workspace.document.emptyBlock');
}

const blocks = computed<WorkspaceDocumentReadBlock[]>(() => {
  if (documentPresentation.value?.kind !== 'blocks') return [];
  return documentPresentation.value.items.map((block) => ({
    ...block,
    text: formatBlockText(block.text),
  }));
});

const emptyPresentationText = computed(() => {
  return documentPresentation.value?.kind === 'outline'
    ? conversationMessage('conversation.tool.workspace.document.nodeEmpty')
    : conversationMessage('conversation.tool.workspace.document.paragraphEmpty');
});

const rangeLabel = computed<string | null>(() => {
  const presentation = documentPresentation.value;
  if (!presentation || presentation.kind === 'text') return null;
  if (presentation.kind === 'outline') {
    const count = presentation.items.length;
    return count > 0
      ? conversationMessage('conversation.tool.workspace.document.nodeCount', { count })
      : conversationMessage('conversation.tool.workspace.document.nodeEmpty');
  }

  const prefix = `${presentation.viewLabel} · `;
  if (blocks.value.length === 0) {
    return `${prefix}${conversationMessage('conversation.tool.workspace.document.paragraphEmpty')}`;
  }
  let minIndex = blocks.value[0].ordinal;
  let maxIndex = blocks.value[0].ordinal;
  for (const b of blocks.value) {
    if (b.ordinal < minIndex) minIndex = b.ordinal;
    if (b.ordinal > maxIndex) maxIndex = b.ordinal;
  }
  if (minIndex === maxIndex) {
    return `${prefix}${conversationMessage('conversation.tool.workspace.document.paragraph', { index: minIndex })}`;
  }
  return `${prefix}${conversationMessage('conversation.tool.workspace.document.paragraphRange', {
    start: minIndex,
    end: maxIndex,
  })}`;
});

// 错误信息
const errorMessage = computed<string>(() => {
  return conversationMessage('conversation.tool.workspace.document.readFailed');
});
</script>
