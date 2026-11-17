<template>
  <AddToKnowledgeBaseModal
    :show="Boolean(selection)"
    :document-name="selection?.displayName ?? ''"
    @close="cancel"
    @confirm="addSelection"
  />
</template>
<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import AddToKnowledgeBaseModal from '@/domains/knowledgebase/ui/AddToKnowledgeBaseModal.vue';
import { addMarkdownDocumentToKb } from '@/domains/knowledgebase/applicationSurface';
import { useNavigationScope } from '@/app/navigation';
import { useNotificationStore } from '@/app/notification';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import { knowledgeDocumentActions } from './orchestration/knowledgeDocumentActions';
const { selection } = knowledgeDocumentActions;
const notifications = useNotificationStore();
const { layoutMessage } = useLayoutLocalization();
const navigationScope = useNavigationScope();
let upload: AbortController | null = null;
function cancel() { upload?.abort(); upload = null; knowledgeDocumentActions.cancel(); }
onBeforeUnmount(cancel);
watch(() => navigationScope.currentScope, cancel);
async function addSelection(targetKbId: string) {
  const snapshot = selection.value;
  if (!snapshot) return;
  const controller = new AbortController();
  upload = controller;
  knowledgeDocumentActions.cancel();
  try {
    const result = await addMarkdownDocumentToKb({ targetKbId,
      documentName: snapshot.displayName, markdown: snapshot.markdown, signal: controller.signal });
    if (!controller.signal.aborted) notifications.show(
      layoutMessage('layout.header.addToKnowledgeBase.success', { fileName: result.fileName }), 'success', 3000);
  } catch (error) {
    if (!controller.signal.aborted) notifications.show(
      error instanceof Error ? error.message : layoutMessage('layout.header.addToKnowledgeBase.failed'), 'error', 3000);
  } finally { if (upload === controller) upload = null; }
}
</script>
