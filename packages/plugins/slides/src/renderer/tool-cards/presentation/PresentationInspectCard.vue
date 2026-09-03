<template>
  <div class="presentation-card presentation-inspect-card">
    <div v-if="presentation.status === 'loading'" class="loading-state">
      <div class="loading-spinner" />
      <span>正在检查演示文稿...</span>
    </div>

    <div v-else-if="presentation.status === 'success'" class="content-container">
      <div class="meta-line">
        共 {{ slideCount ?? pages.length }} 页
      </div>

      <div v-if="pages.length > 0" class="page-list">
        <div v-for="page in pages" :key="page.slideNumber" class="page-item">
          <div class="page-item__title">
            第 {{ page.slideNumber }} 页
            <span v-if="page.layoutKey"> · {{ page.layoutKey }}</span>
          </div>
          <div class="page-item__meta">
            {{ page.elementCount ?? 0 }} 个元素
            <span v-if="typeof page.editableTargetCount === 'number'"> · {{ page.editableTargetCount }} 个可编辑目标</span>
          </div>
          <div class="page-item__actions">
            <button
              type="button"
              class="action-button"
              @click="openSlide(page.slideNumber)"
            >
              打开此页
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="presentation.status === 'error'" class="error-state">
      <span>PPT 检查失败</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SlidesInspectPresentationData } from '../definitions/slidesToolPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<SlidesInspectPresentationData>;
  messageId?: string;
}>();

const navigation = getWorkspaceNavigationPort();

const pages = computed(() => props.presentation.data.pages);
const presentationId = computed(() => props.presentation.data.presentationId);
const slideCount = computed(() => props.presentation.data.slideCount);

function openSlide(slideNumber: number) {
  if (!presentationId.value) return;
  void navigation.openDocumentTarget({
    documentId: presentationId.value,
    type: 'slides',
    projectId: null,
    parameters: {
      slideNumber,
    },
  });
}
</script>
