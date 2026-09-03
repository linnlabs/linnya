import { requestExportArtifactTarget } from '@plugin/renderer/exportArtifact';
import { showWorkspaceNotification } from '@plugin/renderer/workspaceRuntime';
import { slidesApi } from '../../../services/slidesApi';
import { useSlidesStore } from '../../../store/slidesStore';
import type { PresentationExportUiFormat } from '../definitions/presentationExportUi';
import {
  buildPresentationExportRequest,
  buildPresentationExportTargetRequest,
} from '../functions/presentationExportOptions';
import { usePresentationExportStore } from '../store/presentationExportStore';

export async function runPresentationExport(format: PresentationExportUiFormat): Promise<void> {
  const exportStore = usePresentationExportStore();
  const slidesStore = useSlidesStore();
  const nodeId = slidesStore.currentDeckId;
  if (!nodeId || exportStore.activeDialog !== format || exportStore.isExporting) return;

  exportStore.startExport();
  try {
    const targetResult = await requestExportArtifactTarget(
      buildPresentationExportTargetRequest({
        title: slidesStore.deckPreview?.title ?? '演示文稿',
        format,
      }),
    );
    if (targetResult.status === 'cancelled') {
      exportStore.finishExport();
      return;
    }

    const exportId = globalThis.crypto.randomUUID();
    const stopProgress = format === 'images'
      ? slidesApi.onPresentationImageExportProgress(progress => {
          if (progress.exportId === exportId) {
            exportStore.updateImageProgress(progress.completedPages, progress.totalPages);
          }
        })
      : null;
    const result = await slidesApi.exportPresentation(
      buildPresentationExportRequest({
        nodeId,
        targetToken: targetResult.target.token,
        exportId,
        format,
        chartMode: exportStore.chartMode,
        imageWidthPx: exportStore.imageWidthPx,
      }),
    ).finally(() => stopProgress?.());
    exportStore.finishExport();
    exportStore.close();
    showWorkspaceNotification(`已导出 ${result.fileName}`, 'success', 2500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exportStore.failExport(message);
    showWorkspaceNotification(`导出失败：${message}`, 'error', 4000);
  }
}
