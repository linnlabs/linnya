import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  DEFAULT_PRESENTATION_EXPORT_CHART_MODE,
  DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH,
  type PresentationExportChartMode,
  type PresentationExportImageWidth,
} from '@plugin/slides/shared/presentationExport';
import type { PresentationExportUiFormat } from '../definitions/presentationExportUi';

export const usePresentationExportStore = defineStore('slides-presentation-export', () => {
  const activeDialog = ref<PresentationExportUiFormat | null>(null);
  const chartMode = ref<PresentationExportChartMode>(DEFAULT_PRESENTATION_EXPORT_CHART_MODE);
  const imageWidthPx = ref<PresentationExportImageWidth>(DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH);
  const isExporting = ref(false);
  const errorMessage = ref<string | null>(null);
  const completedImagePages = ref(0);
  const totalImagePages = ref(0);

  function open(format: PresentationExportUiFormat): void {
    activeDialog.value = format;
    chartMode.value = DEFAULT_PRESENTATION_EXPORT_CHART_MODE;
    imageWidthPx.value = DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH;
    errorMessage.value = null;
    completedImagePages.value = 0;
    totalImagePages.value = 0;
  }

  function close(): void {
    if (isExporting.value) return;
    activeDialog.value = null;
    chartMode.value = DEFAULT_PRESENTATION_EXPORT_CHART_MODE;
    imageWidthPx.value = DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH;
    errorMessage.value = null;
    completedImagePages.value = 0;
    totalImagePages.value = 0;
  }

  function setChartMode(value: PresentationExportChartMode): void {
    chartMode.value = value;
  }

  function setImageWidth(value: PresentationExportImageWidth): void {
    imageWidthPx.value = value;
  }

  function startExport(): void {
    isExporting.value = true;
    errorMessage.value = null;
    completedImagePages.value = 0;
    totalImagePages.value = 0;
  }

  function updateImageProgress(completedPages: number, totalPages: number): void {
    completedImagePages.value = completedPages;
    totalImagePages.value = totalPages;
  }

  function finishExport(): void {
    isExporting.value = false;
  }

  function failExport(message: string): void {
    isExporting.value = false;
    errorMessage.value = message;
  }

  function $reset(): void {
    activeDialog.value = null;
    chartMode.value = DEFAULT_PRESENTATION_EXPORT_CHART_MODE;
    imageWidthPx.value = DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH;
    isExporting.value = false;
    errorMessage.value = null;
    completedImagePages.value = 0;
    totalImagePages.value = 0;
  }

  return {
    activeDialog,
    chartMode,
    imageWidthPx,
    isExporting,
    errorMessage,
    completedImagePages,
    totalImagePages,
    open,
    close,
    setChartMode,
    setImageWidth,
    startExport,
    updateImageProgress,
    finishExport,
    failExport,
    $reset,
  };
});
