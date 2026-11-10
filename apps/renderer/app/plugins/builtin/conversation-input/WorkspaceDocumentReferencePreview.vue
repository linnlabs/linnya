<template>
  <component
    :is="Preview"
    :read-target="readTarget"
    :label="reference.label"
  />
</template>
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import { useNavigationScope } from '@/app/navigation';
import { loadReadonlyDocumentPreview } from '@/app/workflows/document-preview';
import { readWorkspaceReferenceIdentity } from './definitions/workspaceReferenceIdentity';
const props = defineProps<{ reference: ConversationReferenceChipInput }>();
const scope = useNavigationScope();
const Preview = defineAsyncComponent(loadReadonlyDocumentPreview);
const readTarget = () => readWorkspaceReferenceIdentity(props.reference, scope.currentProjectId);
</script>
