<template>
  <div
    ref="revisionToolbarTarget"
    class="document-surface__editor-viewport"
  >
    <div class="document-surface__editor-shell editor-shell">
      <div class="scroll-content-wrapper">
        <MarkdownEditorPage />
        <div class="annotation-layer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue';
import { REVISION_TOOLBAR_OVERLAY_TARGET_KEY } from '@/domains/editor/features/Revision';
import MarkdownEditorPage from '@/app/pages/MarkdownEditorPage/MarkdownEditorPage.vue';

const revisionToolbarTarget = ref<HTMLElement | null>(null);
provide(REVISION_TOOLBAR_OVERLAY_TARGET_KEY, revisionToolbarTarget);
</script>
