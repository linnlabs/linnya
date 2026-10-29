import { computed, ref } from 'vue';
import { useLocalization } from '@app/localization';
import { useSlidesStore } from '../../../store/slidesStore';
import { useManualEditSubmission, useSlidesManualEditingStore } from '../../manualEditing';
import { importSlideImage } from './importSlideImage';
import { IMAGE_EDITING_MESSAGES, type ImageEditingMessageKey } from '../definitions/imageEditingMessages';

export function useImageEditing() {
  const slides = useSlidesStore(); const manual = useSlidesManualEditingStore(); const submission = useManualEditSubmission();
  const busy = ref(false);
  const target = computed(() => manual.selectedTargets.length === 1 ? manual.selectedTarget : null);
  const { message: translate } = useLocalization();
  const message = (key: ImageEditingMessageKey) => translate(`slides.imageEditing.${key}`, IMAGE_EDITING_MESSAGES[key]);
  function setFit(fit: string): void {
    if (busy.value || target.value?.targetKind !== 'image' || (fit !== 'cover' && fit !== 'contain')) return;
    submission.enqueue({ operation: { op: 'set_image', targetKind: 'image', target: target.value.authoringRef, fit } });
  }
  async function replaceFile(file: File): Promise<void> {
    const selected = target.value;
    if (busy.value || selected?.targetKind !== 'image') return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { manual.setNotice(message('imageLimit')); return; }
    busy.value = true;
    try {
      await submission.flush();
      const documentId = slides.currentDeckId; const revision = manual.history?.revisionId ?? slides.documentBuildState?.versionId;
      if (!documentId) return;
      const image = await importSlideImage(documentId, file);
      if (slides.currentDeckId !== documentId || (manual.history?.revisionId ?? slides.documentBuildState?.versionId) !== revision) throw new Error(message('changed'));
      await submission.enqueue({ operation: { op: 'set_image', targetKind: 'image', target: selected.authoringRef, assetId: image.assetId } }).settled;
    } catch (error) { manual.setNotice(error instanceof Error ? error.message : message('failed')); }
    finally { busy.value = false; }
  }
  return { target, busy, message, setFit, replaceFile };
}
