<template>
  <aside class="conversation-side-pane">
    <WorkspaceConversationSurface
      presentation="side-pane"
      :is-active="isActive"
      class="conversation-side-pane__surface"
    />
  </aside>
</template>

<script setup lang="ts">
import WorkspaceConversationSurface from '@/app/pages/WorkspaceConversationSurface/WorkspaceConversationSurface.vue';

defineProps<{
  isActive: boolean;
}>();
</script>
