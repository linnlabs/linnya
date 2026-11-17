<template>
  <component
    v-if="surface?.contribution.projectAssociationComponent"
    :is="surface.contribution.projectAssociationComponent"
    :key="`${surface.pluginId}:${projectId}`"
    :project-id="projectId"
    :project-name="projectName"
    @close="emit('close')"
  />
</template>
<script setup lang="ts">
import { useApplicationSurface } from '@/app/plugins/composables';
defineProps<{ projectId: string; projectName?: string }>();
const emit = defineEmits<{ close: [] }>();
const surface = useApplicationSurface('knowledge-base');
</script>
