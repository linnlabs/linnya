<template>
  <div class="document-surface__editor-shell editor-shell">
    <div class="scroll-content-wrapper">
      <MarkdownEditorPage />
      <div class="annotation-layer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownEditorPage from '@/app/pages/MarkdownEditorPage/MarkdownEditorPage.vue';
</script>
