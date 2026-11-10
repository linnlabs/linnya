<template>
  <DropdownPanel
    :show="search.state.open.value"
    class="canvas-floating-panel canvas-search-panel"
    role="search"
    :aria-label="t('canvas.search.label')"
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
        :placeholder="t('canvas.search.placeholder')"
        :aria-label="t('canvas.search.input')"
        @update:model-value="search.state.setQuery($event)"
      />
      <IconButton :label="t('canvas.search.close')" size="sm" @click="close">
        <CloseIcon />
      </IconButton>
    </div>
    <p v-if="search.state.query.value" class="canvas-panel-meta" role="status">
      {{ t('canvas.search.results', { count: search.hits.value.length }) }}
    </p>
    <ol class="canvas-panel-list">
      <li v-for="(hit, index) in search.hits.value.slice(0, 100)" :key="hit.id">
        <button
          type="button"
          class="canvas-panel-row"
          :class="{ 'canvas-panel-row--active': search.state.index.value === index }"
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
import { canvasText as t } from '../../localization';
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
