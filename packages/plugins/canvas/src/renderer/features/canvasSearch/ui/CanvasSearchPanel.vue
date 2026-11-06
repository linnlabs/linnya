<template>
  <section
    v-if="search.state.open.value"
    class="canvas-search-panel"
    aria-label="画布内搜索"
    @pointerdown.stop
    @keydown="keydown"
  >
    <div class="canvas-search-input-row">
      <input
        ref="input"
        :value="search.state.query.value"
        placeholder="搜索卡片内容…"
        aria-label="搜索卡片内容"
        @input="update"
        @keydown.enter.prevent="search.navigate($event.shiftKey ? -1 : 1)"
      />
      <button type="button" aria-label="关闭搜索" @click="close">×</button>
    </div>
    <p v-if="search.state.query.value">{{ search.hits.value.length }} 个结果</p>
    <ol>
      <li v-for="(hit, index) in search.hits.value.slice(0, 100)" :key="hit.id">
        <button
          type="button"
          :class="{ active: search.state.index.value === index }"
          @click="search.jump(index)"
        >
          {{ hit.text }}
        </button>
      </li>
    </ol>
  </section>
</template>
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { createCanvasSearch } from '../orchestration/createCanvasSearch';
const props = defineProps<{ search: ReturnType<typeof createCanvasSearch> }>();
const emit = defineEmits<{ close: [] }>();
const input = ref<HTMLInputElement | null>(null);
watch(props.search.state.open, async open => {
  if (open) {
    await nextTick();
    input.value?.focus();
    input.value?.select();
  }
});
const update = (event: Event) => {
  if (event.target instanceof HTMLInputElement) props.search.state.setQuery(event.target.value);
};
const close = () => {
  props.search.state.close();
  emit('close');
};
const keydown = (event: KeyboardEvent) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
};
</script>
