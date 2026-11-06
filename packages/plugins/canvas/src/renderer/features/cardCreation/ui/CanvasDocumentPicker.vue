<template>
  <section
    v-if="creation.picker.open.value"
    class="canvas-document-picker"
    aria-label="添加文档卡片"
    @pointerdown.stop
    @keydown.stop
  >
    <div class="canvas-search-input-row">
      <input
        aria-label="搜索项目文档"
        placeholder="搜索当前项目文档…"
        @input="query"
        @keydown.esc.prevent="creation.picker.close()"
      />
      <button type="button" aria-label="关闭文档选择" @click="creation.picker.close()">×</button>
    </div>
    <p v-if="creation.picker.loading.value" role="status">正在搜索…</p>
    <p v-if="creation.picker.error.value" role="alert">
      {{ creation.picker.error.value }}
    </p>
    <ol>
      <li v-for="candidate in creation.picker.candidates.value" :key="candidate.documentId">
        <button type="button" @click="creation.addDocument(candidate.documentId)">
          {{ candidate.title }}<small>{{ candidate.path }}</small>
        </button>
      </li>
    </ol>
  </section>
</template>
<script setup lang="ts">
import type { createCanvasCardCreation } from '../orchestration/createCanvasCardCreation';
const props = defineProps<{ creation: ReturnType<typeof createCanvasCardCreation> }>();
const query = (event: Event) => {
  if (event.target instanceof HTMLInputElement) void props.creation.query(event.target.value);
};
</script>
