import { computed, ref, watch } from 'vue';
import { useSlidesStore } from '../../../store/slidesStore';
import { useManualEditSubmission, useSlidesManualEditingStore } from '../../manualEditing';
import { ownsDocumentShortcut, useTextInputSession } from '../../editingInteraction';
import { slidesApi } from '../../../services/slidesApi';
import { useSlidesElementClipboardStore } from '../store/slidesElementClipboardStore';

/** 同稿会话剪贴板保存完整作者值；粘贴每次生成新身份，切稿即清空。 */
export function useElementClipboard() {
  const slides = useSlidesStore(); const manual = useSlidesManualEditingStore(); const clipboard = useSlidesElementClipboardStore();
  const submission = useManualEditSubmission(); const text = useTextInputSession(submission); const busy = ref(false);
  watch(() => slides.currentDeckId, () => clipboard.write(null));
  const canCopy = computed(() => manual.enabled && !busy.value && manual.selectedTargets.length > 0
    && manual.selectedTargets.every(target => target.capabilities.includes('copy')));
  const canPaste = computed(() => manual.enabled && !busy.value && !manual.pendingPageOperation && clipboard.content?.documentId === slides.currentDeckId && slides.documentBuildState?.state === 'ready');
  async function copy(): Promise<boolean> {
    if (!canCopy.value || text.requestCommit() === 'blocked') return false;
    const targets = manual.selectedTargets.map(target => target.authoringRef);
    busy.value = true;
    try {
      await submission.flush();
      const documentId = slides.currentDeckId; const state = slides.documentBuildState;
      if (!documentId || state?.state !== 'ready') return false;
      // flush 等待保存，正式画面可能仍在刷新；复制应读取已提交的作者值。
      const objects = await slidesApi.copyObjects(documentId, manual.history?.revisionId ?? state.versionId, targets);
      if (slides.currentDeckId !== documentId) return false;
      clipboard.write({ documentId, objects }); return true;
    } catch (error) { if (error instanceof Error) manual.setNotice(error.message); return false; }
    finally { busy.value = false; }
  }
  function paste(): void {
    const content = clipboard.content;
    if (!canPaste.value || !content || text.requestCommit() === 'blocked') return;
    const objects = content.objects.map(object => ({ ...object, editKey: `inserted-${crypto.randomUUID()}`,
      box: { ...object.box, x: object.box.x + 0.2, y: object.box.y + 0.2 } }));
    submission.enqueue({ operation: { op: 'insert_objects', index: slides.currentSlideIndex, objects } });
  }
  async function duplicate(): Promise<void> { if (await copy()) paste(); }
  function handleClipboardShortcut(event: KeyboardEvent): void {
    if (!manual.enabled || !ownsDocumentShortcut(event) || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (!['c', 'v', 'd'].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (key === 'c') void copy(); else if (key === 'v') paste(); else void duplicate();
  }
  return { canCopy, canPaste, copy, paste, duplicate, handleClipboardShortcut };
}
