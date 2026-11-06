<template>
  <DropdownPanel
    :show="search.state.open.value"
    class="canvas-floating-panel canvas-search-panel"
    role="search"
    aria-label="画布内搜索"
    @pointerdown.stop
    @keydown="keydown"
  >
    <div class="canvas-panel-header">
      <CustomTextInput
        ref="input"
        class="canvas-panel-input"
        type="search"
        size="compact"
        :model-value="search.state.query.value"
        placeholder="搜索卡片内容…"
        aria-label="搜索卡片内容"
        @update:model-value="search.state.setQuery($event)"
      />
      <IconButton label="关闭搜索" size="sm" @click="close"><CloseIcon /></IconButton>
    </div>
    <p v-if="search.state.query.value" class="canvas-panel-meta" role="status">
      {{ search.hits.value.length }} 个结果
    </p>
    <ol class="canvas-panel-list">
      <li v-for="(hit, index) in search.hits.value.slice(0, 100)" :key="hit.id">
        <button
          type="button"
          class="canvas-panel-row"
          :class="{ 'is-active': search.state.index.value === index }"
          :aria-current="search.state.index.value === index ? 'true' : undefined"
          @click="search.jump(index)"
        >
          {{ hit.text }}
        </button>
      </li>
    </ol>
  </DropdownPanel>
</template>
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { CustomTextInput, DropdownPanel, IconButton } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import type { createCanvasSearch } from '../orchestration/createCanvasSearch';
const props = defineProps<{ search: ReturnType<typeof createCanvasSearch> }>();
const emit = defineEmits<{ close: [] }>();
const input = ref<InstanceType<typeof CustomTextInput> | null>(null);
watch(props.search.state.open, async open => {
  if (open) {
    await nextTick();
    input.value?.focus();
    input.value?.select();
  }
});
const close = () => {
  props.search.state.close();
  emit('close');
};
const keydown = (event: KeyboardEvent) => {
  event.stopPropagation();
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    props.search.navigate(event.shiftKey ? -1 : 1);
  }
};
</script>
