<template>
  <Modal
    :is-visible="isVisible"
    :title="title"
    width="480px"
    scroll-mode="content"
    :close-on-overlay-click="!isExporting"
    :close-on-esc="!isExporting"
    @close="close"
  >
    <div class="slides-export-modal">
      <slot />
      <p v-if="errorMessage" class="slides-export-modal__error">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <div class="slides-export-modal__footer">
        <ActionButtons
          :primary-action-text="isExporting ? '导出中…' : '导出'"
          secondary-action-text="取消"
          :is-primary-action-disabled="isExporting"
          :is-secondary-action-disabled="isExporting"
          @primary-click="runPresentationExport(format)"
          @secondary-click="close"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { ActionButtons } from '@linnya/renderer-ui';
import { Modal } from '@linnya/renderer-ui';
import type { PresentationExportUiFormat } from '../definitions/presentationExportUi';
import { runPresentationExport } from '../orchestration/presentationExportWorkflow';
import { usePresentationExportStore } from '../store/presentationExportStore';

const props = defineProps<{
  readonly format: PresentationExportUiFormat;
  readonly title: string;
}>();

const exportStore = usePresentationExportStore();
const { activeDialog, errorMessage, isExporting } = storeToRefs(exportStore);
const isVisible = computed(() => activeDialog.value === props.format);

function close(): void {
  exportStore.close();
}
</script>
