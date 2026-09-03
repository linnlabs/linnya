<template>
  <PresentationExportModalFrame format="images" title="导出为图片">
    <p class="slides-export-modal__description">
      所有页面将导出为 PNG，并按页码顺序放入一个 ZIP 文件。
    </p>
    <fieldset class="slides-export-modal__choice-group">
      <legend>分辨率</legend>
      <CustomRadio
        v-for="option in imageOptions"
        :key="option.value"
        :model-value="imageWidthPx"
        :value="option.value"
        name="slides-export-image-width"
        :disabled="isExporting"
        @update:model-value="updateImageWidth"
      >
        <span class="slides-export-modal__choice-label">{{ option.label }}</span>
        <span class="slides-export-modal__choice-description">{{ option.description }}</span>
      </CustomRadio>
    </fieldset>
    <div v-if="isExporting" class="slides-export-modal__progress">
      <div class="slides-export-modal__progress-summary">
        <span>{{ progressLabel }}</span>
        <span>{{ progressPercent }}%</span>
      </div>
      <div
        class="slides-export-modal__progress-track"
        role="progressbar"
        aria-label="图片导出进度"
        :aria-valuenow="progressPercent"
        :aria-valuetext="progressLabel"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span
          class="slides-export-modal__progress-value"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </div>
  </PresentationExportModalFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { CustomRadio } from '@linnya/renderer-ui';
import {
  PRESENTATION_EXPORT_IMAGE_WIDTHS,
  isPresentationExportImageWidth,
  type PresentationExportImageWidth,
} from '@plugin/slides/shared/presentationExport';
import { useSlidesStore } from '../../../store/slidesStore';
import {
  resolvePresentationExportPixelSize,
  resolvePresentationImageExportProgressPercent,
} from '../functions/presentationExportOptions';
import { usePresentationExportStore } from '../store/presentationExportStore';
import PresentationExportModalFrame from './PresentationExportModalFrame.vue';

const exportStore = usePresentationExportStore();
const slidesStore = useSlidesStore();
const {
  completedImagePages,
  imageWidthPx,
  isExporting,
  totalImagePages,
} = storeToRefs(exportStore);

const progressPercent = computed(() => resolvePresentationImageExportProgressPercent({
  completedPages: completedImagePages.value,
  totalPages: totalImagePages.value,
}));
const progressLabel = computed(() => {
  if (totalImagePages.value === 0) return '正在准备页面…';
  if (completedImagePages.value === totalImagePages.value) return '页面已生成，正在保存…';
  return `已完成 ${completedImagePages.value} / ${totalImagePages.value} 页`;
});

const optionNames: Readonly<Record<PresentationExportImageWidth, string>> = {
  1280: '标准',
  1920: '高清',
  3840: '4K',
};

const imageOptions = computed(() => PRESENTATION_EXPORT_IMAGE_WIDTHS.map(width => {
  const size = slidesStore.deckPreview
    ? resolvePresentationExportPixelSize({
        widthPx: width,
        slideWidth: slidesStore.deckPreview.slideSize.width,
        slideHeight: slidesStore.deckPreview.slideSize.height,
      })
    : null;
  return {
    value: width,
    label: optionNames[width],
    description: size ? `${size.width} × ${size.height} 像素` : `${width} 像素宽`,
  };
}));

function updateImageWidth(value: string | number | boolean): void {
  if (isPresentationExportImageWidth(value)) {
    exportStore.setImageWidth(value);
  }
}
</script>
