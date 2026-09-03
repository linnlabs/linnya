<!--
  apps/renderer/app/pages/MarkdownEditorPage/MarkdownEditorPage.vue
  
  Markdown 富文本页面：组装平台 Editor 领域组件。
  只负责渲染平台 Markdown 文档，不是插件通用 Document Surface。
-->
<template>
  <EditorContext>
    <template #default="{ editor }">
      <div class="main-flow">
        <EditorContent :editor="editor" />
      </div>
    </template>
  </EditorContext>
</template>

<script setup lang="ts">
import EditorContext from '@/domains/editor/ui/EditorContext.vue';
import EditorContent from '@/domains/editor/ui/EditorContent.vue';
</script>
