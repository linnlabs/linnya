import { computed, ref, watch } from 'vue';
import { useSlidesStore } from '../../../store/slidesStore';
import { useManualEditSubmission, useSlidesManualEditingStore } from '../../manualEditing';
import { ownsDocumentShortcut, useTextInputSession } from '../../editingInteraction';
import { slidesApi } from '../../../services/slidesApi';
import { useSlidesElementClipboardStore } from '../store/slidesElementClipboardStore';
import type { SlideClipboardContent } from '../definitions/elementClipboard';
import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';

const PASTE_OFFSET = 0.2;

/** 同稿会话剪贴板保存完整作者值；粘贴每次生成新身份，切稿即清空。 */
export function useElementClipboard() {
  const slides = useSlidesStore();
  const manual = useSlidesManualEditingStore();
  const clipboard = useSlidesElementClipboardStore();
  const submission = useManualEditSubmission();
  const text = useTextInputSession(submission);
  const busy = ref(false);
  watch(() => slides.currentDeckId, () => clipboard.write(null));
  const canCopy = computed(() => manual.enabled && !busy.value && manual.selectedTargets.length > 0
    && manual.selectedTargets.every(target => target.capabilities.includes('copy')));
  const canInsert = computed(() => manual.enabled && !busy.value && !manual.pendingPageOperation && slides.documentBuildState?.state === 'ready');
  const canPaste = computed(() => canInsert.value && clipboard.content?.documentId === slides.currentDeckId);
  /** 读取已提交的作者值；复制写入剪贴板，重复直接粘贴，不覆盖用户已复制的内容。 */
  async function readSelection(): Promise<SlideClipboardContent | null> {
    if (!canCopy.value || text.requestCommit() === 'blocked') return null;
    const targets = manual.selectedTargets.map(target => target.authoringRef);
    busy.value = true;
    try {
      await submission.flush();
      const documentId = slides.currentDeckId;
      const state = slides.documentBuildState;
      if (!documentId || state?.state !== 'ready') return null;
      // flush 等待保存，正式画面可能仍在刷新；复制应读取已提交的作者值。
      const objects = await slidesApi.copyObjects(documentId, manual.history?.revisionId ?? state.versionId, targets);
      return slides.currentDeckId === documentId ? { documentId, objects } : null;
    } catch (error) {
      if (error instanceof Error) manual.setNotice(error.message);
      return null;
    } finally {
      busy.value = false;
    }
  }
  async function copy(): Promise<boolean> {
    const content = await readSelection();
    if (content) clipboard.write(content);
    return content !== null;
  }
  function pasteContent(content: SlideClipboardContent): readonly SlidesInsertedObject[] | null {
    if (text.requestCommit() === 'blocked') return null;
    const objects = content.objects.map(object => ({ ...object, editKey: `inserted-${crypto.randomUUID()}`,
      box: { ...object.box, x: object.box.x + PASTE_OFFSET, y: object.box.y + PASTE_OFFSET } }));
    const documentId = slides.currentDeckId;
    const index = slides.currentSlideIndex;
    const previousSelection = manual.selectedTargets.map(target => target.elementId).join('\0');
    const ticket = submission.enqueue({ operation: { op: 'insert_objects', index, objects } });
    void ticket.settled.then(result => {
      // 与插入一致：呈现后选中副本，便于继续拖动；等待期间用户已改选或换页则不打扰。
      if (result.status !== 'presented' || slides.currentDeckId !== documentId || slides.currentSlideIndex !== index
        || manual.selectedTargets.map(target => target.elementId).join('\0') !== previousSelection) return;
      manual.requestReveal({ targets: objects.map(object => ({ editKey: object.editKey })) });
    });
    return objects;
  }
  function paste(): void {
    const content = clipboard.content;
    if (!canPaste.value || !content) return;
    const objects = pasteContent(content);
    // 连续粘贴逐次错开，不叠在同一位置。
    if (objects) clipboard.write({ documentId: content.documentId, objects });
  }
  async function duplicate(): Promise<void> {
    const content = await readSelection();
    if (content && canInsert.value) pasteContent(content);
  }
  function handleClipboardShortcut(event: KeyboardEvent): void {
    if (!manual.enabled || !ownsDocumentShortcut(event) || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (!['c', 'v', 'd'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (key === 'c') void copy(); else if (key === 'v') paste(); else void duplicate();
  }
  return { canCopy, canPaste, copy, paste, duplicate, handleClipboardShortcut };
}
