import { computed, ref } from 'vue';
import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
import { useLocalization } from '@app/localization';
import { useSlidesStore } from '../../documentRuntime';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { importSlideImage } from '../../imageEditing';
import { useManualEditSubmission, useSlidesManualEditingStore } from '../../manualEditing';
import { useTextInputSession } from '../../editingInteraction';
import { INSERTION_MESSAGES } from '../definitions/insertionMessages';
import { createInsertedObject } from '../functions/createInsertedObject';
import { resolveInsertionPalette } from '../functions/resolveInsertionPalette';

export function useElementInsertion() {
  const slides = useSlidesStore();
  const render = useSlidesRenderStore();
  const manual = useSlidesManualEditingStore();
  const submission = useManualEditSubmission();
  const text = useTextInputSession(submission);
  const busy = ref(false);
  const { message: translate } = useLocalization();
  const message = (key: keyof typeof INSERTION_MESSAGES) => translate(key, INSERTION_MESSAGES[key]);
  const available = computed(() => manual.enabled && !manual.pendingPageOperation && slides.documentBuildState?.state === 'ready' && !!render.currentSlideRender && !busy.value);

  async function insert(objects: readonly SlidesInsertedObject[], index = slides.currentSlideIndex, insertionImageSources?: ReadonlyMap<string, string>): Promise<void> {
    const documentId = slides.currentDeckId;
    const previousSelection = manual.selectedTargets.map(target => target.elementId).join('\0');
    const result = await submission.enqueue({ operation: { op: 'insert_objects', index, objects }, ...(insertionImageSources ? { insertionImageSources } : {}) }).settled;
    // 等待期间用户已改选、换页或换稿时，不抢走他们的选区。
    if (result.status !== 'presented' || slides.currentDeckId !== documentId || slides.currentSlideIndex !== index || manual.selectedTargets.map(target => target.elementId).join('\0') !== previousSelection) return;
    const [only] = objects;
    manual.requestReveal({ targets: objects.map(object => ({ editKey: object.editKey })), editText: objects.length === 1 && only?.kind === 'text' });
  }
  function insertSimple(kind: 'text' | 'rect' | 'ellipse'): void {
    const size = render.renderModel?.slideSize;
    if (!available.value || !size || text.requestCommit() === 'blocked') return;
    const palette = resolveInsertionPalette(slides.deckPreview?.theme.colors, render.currentSlideRender?.background);
    void insert([createInsertedObject(kind, size, message('slides.insert.placeholder'), `inserted-${crypto.randomUUID()}`, palette)]);
  }
  async function insertImage(file: File): Promise<void> {
    if (!available.value || text.requestCommit() === 'blocked') return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { manual.setNotice(message('slides.insert.imageLimit')); return; }
    busy.value = true;
    try {
      await submission.flush();
      const documentId = slides.currentDeckId;
      const revision = manual.history?.revisionId ?? slides.documentBuildState?.versionId;
      const index = slides.currentSlideIndex;
      const size = render.renderModel?.slideSize;
      if (!documentId || !size) return;
      const image = await importSlideImage(documentId, file);
      const scale = Math.min(size.width * 0.6 / image.width, size.height * 0.6 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      const assetId = image.assetId;
      if (slides.currentDeckId !== documentId || (manual.history?.revisionId ?? slides.documentBuildState?.versionId) !== revision || slides.currentSlideIndex !== index) throw new Error(message('slides.insert.changed'));
      const editKey = `inserted-${crypto.randomUUID()}`;
      await insert([{ kind: 'image', editKey, assetId, fit: 'contain', alt: file.name,
        box: { x: (size.width - w) / 2, y: (size.height - h) / 2, w, h } }], index, new Map([[editKey, image.previewSource]]));
    } catch (error) {
      manual.setNotice(error instanceof Error ? error.message : message('slides.insert.failed'));
    } finally {
      busy.value = false;
    }
  }
  return { available, busy, message, insertSimple, insertImage };
}
