<template>
  <component
    :is="Preview"
    :read-target="readTarget"
    :label="reference.label"
    @ready="emit('ready')"
  />
</template>
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import { useNavigationScope } from '@/app/navigation';
import { loadReadonlyDocumentPreview } from '@/app/workflows/document-preview';
import { readWorkspaceReferenceIdentity } from './definitions/workspaceReferenceIdentity';
const props = defineProps<{ reference: ConversationReferenceChipInput }>();
// 首屏排好后通知引用标签露出弹层（见 ConversationReferenceKindContribution.previewComponent）。
const emit = defineEmits<{ ready: [] }>();
const scope = useNavigationScope();
const Preview = defineAsyncComponent(loadReadonlyDocumentPreview);
const readTarget = () => readWorkspaceReferenceIdentity(props.reference, scope.currentProjectId);
</script>
