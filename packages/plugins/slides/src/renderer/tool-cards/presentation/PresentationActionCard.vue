<template>
  <div class="presentation-card presentation-action-card">
    <div v-if="presentation.status === 'loading'" class="loading-state">
      <div class="loading-spinner" />
      <span>{{ loadingText }}</span>
    </div>

    <div v-else-if="presentation.status === 'success'" class="content-container">
      <div v-if="resultAction" class="result-action">
        <span>{{ resultAction.verb }}</span>
        <button
          v-if="resultAction.canOpen"
          type="button"
          class="presentation-link"
          :title="resultAction.title"
          @click="openPresentation"
        >
          {{ resultAction.title }}
        </button>
        <span v-else class="presentation-name" :title="resultAction.title">
          {{ resultAction.title }}
        </span>
        <span>。</span>
      </div>

      <div v-if="summaryLines.length > 0" class="summary-list">
        <div v-for="line in summaryLines" :key="line" class="summary-item">
          {{ line }}
        </div>
      </div>

    </div>

    <div v-else-if="presentation.status === 'error'" class="error-state">
      <span>PPT 工具执行失败</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SlidesExportPresentationData } from '../definitions/slidesToolPresentation';

interface ResultAction {
  verb: string;
  title: string;
  canOpen: boolean;
}

const props = defineProps<{
  presentation: ToolCardPresentation<SlidesExportPresentationData>;
  messageId?: string;
}>();

const navigation = getWorkspaceNavigationPort();

const presentationId = computed(() => props.presentation.data.presentationId ?? undefined);
const resultAction = computed<ResultAction | null>(() => {
  const title = props.presentation.data.fileName;
  if (!title) return null;
  return {
    verb: '已导出',
    title,
    canOpen: !!presentationId.value,
  };
});
const summaryLines = computed(() => {
  const sizeBytes = props.presentation.data.sizeBytes;
  return sizeBytes === null ? [] : [`文件大小：${Math.round(sizeBytes / 1024)} KB`];
});

const loadingText = computed(() => {
  if (props.presentation.status !== 'loading') return '';
  return '正在处理演示文稿...';
});

function openPresentation() {
  if (!presentationId.value) return;
  void navigation.openDocumentTarget({
    documentId: presentationId.value,
    type: 'slides',
    projectId: null,
  });
}

</script>
