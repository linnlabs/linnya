import { watch } from 'vue';
import { useSlidesStore } from '../../features/documentRuntime';
import { useSlidesManualSubmissionStore } from '../../features/manualEditing/submission';
import { slidesApi } from '../../services/slidesApi';

/** 页面组合根在外部版本变化/重开时同步可撤销事实；旧响应不能覆盖新的文档或提交。 */
export function useSlidesEditingHistoryStatus(): void {
  const slides = useSlidesStore();
  const manual = useSlidesManualSubmissionStore();
  watch(() => [slides.currentDeckId, slides.documentBuildState, manual.submission.phase] as const,
    async ([documentId, build, phase], _previous, onCleanup) => {
      if (!documentId || build?.state !== 'ready' || phase !== 'idle' || manual.history?.revisionId === build.versionId) return;
      manual.setHistory(null);
      let active = true;
      onCleanup(() => { active = false; });
      try {
        const status = await slidesApi.readManualEditHistory(documentId);
        if (active && status.revisionId === build.versionId) manual.setHistory(status);
      } catch {
        if (active) manual.setHistoryError(true);
      }
    }, { immediate: true });
}
