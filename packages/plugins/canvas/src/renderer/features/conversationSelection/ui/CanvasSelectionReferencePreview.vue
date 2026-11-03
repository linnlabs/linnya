<template>
  <section :aria-label="reference.label">
    <strong>{{ reference.label }}</strong>
    <p role="status">
      {{ preview.error.value || preview.content.value || '正在读取画布选区…' }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import type { ConversationReferenceChipInput } from '@plugin/renderer/conversationInputContribution';
import type { CanvasSelectionReferencePort } from '../definitions/canvasSelectionReference';
import { createCanvasSelectionPreview } from '../orchestration/createCanvasSelectionPreview';
const props = defineProps<{ reference: ConversationReferenceChipInput; read: CanvasSelectionReferencePort['read'] }>();
const preview = createCanvasSelectionPreview(props.read, getCurrentWorkspaceProjectId);
watch([() => props.reference, getCurrentWorkspaceProjectId], () => { void preview.refresh(props.reference); }, { immediate: true });
onBeforeUnmount(preview.dispose);
</script>
