<template>
  <WorkspaceDocumentViewCard
    v-if="documentPresentation"
    :presentation="documentPresentation"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCardPresentation } from '../types';
import type { WorkspaceDocumentViewPresentationData } from './definitions/workspaceDocumentViewPresentation';
import type { WorkspaceReadFilePresentationData } from './definitions/workspaceFileHeaderPresentation';
import WorkspaceDocumentViewCard from './WorkspaceDocumentViewCard.vue';

const props = defineProps<{
  presentation: ToolCardPresentation<WorkspaceReadFilePresentationData>;
}>();

const documentPresentation = computed<ToolCardPresentation<WorkspaceDocumentViewPresentationData> | null>(() => {
  const data = props.presentation.data;
  if (data.kind !== 'snapshot' || !data.document) return null;
  return {
    ...props.presentation,
    data: {
      kind: 'snapshot',
      document: data.document,
    },
  };
});
</script>
