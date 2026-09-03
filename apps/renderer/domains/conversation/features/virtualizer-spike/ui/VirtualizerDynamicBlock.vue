<template>
  <section
    class="dynamic-matrix-block"
    :data-dynamic-kind="block.kind"
  >
    <header>{{ block.kind }}</header>
    <img
      v-if="block.kind === 'image' && block.extent > 0"
      class="dynamic-matrix-block__image"
      :src="`/icons/icon.ico?dynamic-resize=${encodeURIComponent(block.id)}`"
      alt=""
      decoding="async"
      :style="{ width: `${block.extent}px` }"
    >
    <div
      v-else-if="block.kind === 'chart'"
      class="dynamic-matrix-block__chart"
      :style="{ height: `${block.extent}px` }"
    >
      <span
        v-for="bar in 5"
        :key="bar"
        :style="{ height: `${20 + bar * 12}%` }"
      />
    </div>
    <pre
      v-else-if="block.kind === 'bash'"
      class="dynamic-matrix-block__bash"
    ><code><span
      v-for="line in block.extent"
      :key="line"
    >fixture output {{ line }}
</span></code></pre>
  </section>
</template>

<script setup lang="ts">
import type { VirtualizerDynamicBlock } from '../definitions/dynamicResizeMatrix';

defineProps<{
  block: VirtualizerDynamicBlock;
}>();
</script>
