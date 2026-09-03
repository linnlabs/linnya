<template>
  <PresentationExportModalFrame format="pptx" title="导出为 PPTX">
    <p class="slides-export-modal__description">
      导出后仍可在 PowerPoint 中编辑文字、形状和图表。
    </p>
    <CustomCheckbox
      :model-value="convertChartsToImages"
      @update:model-value="updateChartMode"
    >
      将图表转换为图片
      <template #description>
        保持与 Linnya 预览时的一致性；转换后图表不可编辑，图片使用透明背景。
      </template>
    </CustomCheckbox>
  </PresentationExportModalFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CustomCheckbox } from '@linnya/renderer-ui';
import { usePresentationExportStore } from '../store/presentationExportStore';
import PresentationExportModalFrame from './PresentationExportModalFrame.vue';

const exportStore = usePresentationExportStore();
const convertChartsToImages = computed(() => exportStore.chartMode === 'image');

function updateChartMode(value: boolean | Array<string | number | boolean>): void {
  if (typeof value === 'boolean') {
    exportStore.setChartMode(value ? 'image' : 'native');
  }
}
</script>
