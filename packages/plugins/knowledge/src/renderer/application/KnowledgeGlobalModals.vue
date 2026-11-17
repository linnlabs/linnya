<template>
  <AddToKnowledgeBaseModal
    :show="Boolean(selection)"
    :document-name="selection?.displayName ?? ''"
    @close="cancel"
    @confirm="addSelection"
  />
</template>
<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import AddToKnowledgeBaseModal from '../ui/AddToKnowledgeBaseModal.vue';
import { addMarkdownDocumentToKb } from '../applicationSurface';
import { showWorkspaceNotification } from '@plugin/renderer/workspaceRuntime';
import { useKnowledgeBaseLocalization } from '../ui/useKnowledgeBaseLocalization';
import { knowledgeDocumentActions } from './orchestration/knowledgeDocumentActions';
const { selection } = knowledgeDocumentActions;
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();
let upload: AbortController | null = null;
function cancel() { upload?.abort(); upload = null; knowledgeDocumentActions.cancel(); }
onBeforeUnmount(cancel);
async function addSelection(targetKbId: string) {
  const snapshot = selection.value;
  if (!snapshot) return;
  const controller = new AbortController();
  upload = controller;
  knowledgeDocumentActions.cancel();
  try {
    const result = await addMarkdownDocumentToKb({ targetKbId,
      documentName: snapshot.displayName, markdown: snapshot.markdown, signal: controller.signal });
    if (!controller.signal.aborted) showWorkspaceNotification(
      knowledgeBaseMessage('knowledgeBase.addDocument.success', { fileName: result.fileName }), 'success', 3000);
  } catch (error) {
    if (!controller.signal.aborted) showWorkspaceNotification(
      error instanceof Error ? error.message : knowledgeBaseMessage('knowledgeBase.addDocument.failed'), 'error', 3000);
  } finally { if (upload === controller) upload = null; }
}
</script>
