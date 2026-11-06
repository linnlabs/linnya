<template>
  <DropdownPanel
    :show="creation.picker.open.value"
    class="canvas-floating-panel canvas-document-picker"
    role="dialog"
    aria-label="添加文档卡片"
    @pointerdown.stop
    @keydown.stop="keydown"
  >
    <div class="canvas-panel-header">
      <CustomTextInput
        ref="input"
        class="canvas-panel-input"
        type="search"
        size="compact"
        :model-value="text"
        aria-label="搜索项目文档"
        placeholder="搜索当前项目文档…"
        @update:model-value="query"
      />
      <IconButton label="关闭文档选择" size="sm" @click="creation.picker.close()">
        <CloseIcon />
      </IconButton>
    </div>
    <SkeletonRows v-if="creation.picker.loading.value" :rows="4" size="lg" label="正在搜索文档" />
    <p v-if="creation.picker.error.value" class="canvas-panel-error" role="alert">
      {{ creation.picker.error.value }}
    </p>
    <ol class="canvas-panel-list">
      <li v-for="candidate in creation.picker.candidates.value" :key="candidate.documentId">
        <button
          type="button"
          class="canvas-panel-row"
          @click="creation.addDocument(candidate.documentId)"
        >
          <span class="canvas-panel-row-title">{{ candidate.title }}</span>
          <small>{{ candidate.path }}</small>
        </button>
      </li>
    </ol>
  </DropdownPanel>
</template>
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { CustomTextInput, DropdownPanel, IconButton, SkeletonRows } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import type { createCanvasCardCreation } from '../orchestration/createCanvasCardCreation';
const props = defineProps<{ creation: ReturnType<typeof createCanvasCardCreation> }>();
const input = ref<InstanceType<typeof CustomTextInput> | null>(null),
  text = ref('');
watch(props.creation.picker.open, async open => {
  if (!open) return;
  text.value = '';
  await nextTick();
  input.value?.focus();
});
const query = (value: string) => {
  text.value = value;
  void props.creation.query(value);
};
const keydown = (event: KeyboardEvent) => {
  if (!event.isComposing && event.key === 'Escape') {
    event.preventDefault();
    props.creation.picker.close();
  }
};
</script>
