<template>
  <div
    v-if="row.kind === 'spacer'"
    class="dynamic-matrix-row dynamic-matrix-row--spacer"
    :style="{ height: `${row.heightPx}px` }"
  />
  <article
    v-else-if="row.kind === 'dynamic'"
    class="dynamic-matrix-row dynamic-matrix-row--content"
  >
    <div :class="{ 'dynamic-matrix-row__bounded-body': row.bounded }">
      <VirtualizerDynamicBlock :block="row.block" />
    </div>
  </article>
  <article
    v-else-if="row.kind === 'anchor'"
    class="dynamic-matrix-row dynamic-matrix-row--anchor"
    :data-virtualizer-dynamic-anchor="row.anchorKey"
  >
    Stable viewport anchor
  </article>
  <article
    v-else
    class="dynamic-matrix-row dynamic-matrix-row--turn"
  >
    <div class="dynamic-matrix-row__turn-leading" />
    <div :class="{ 'dynamic-matrix-row__bounded-body': row.bounded }">
      <VirtualizerDynamicBlock
        v-for="block in row.blocks"
        :key="block.id"
        :block="block"
      />
    </div>
    <div
      class="dynamic-matrix-row__turn-anchor"
      :data-virtualizer-dynamic-anchor="row.anchorKey"
    >
      Stable anchor inside one giant turn
    </div>
    <div class="dynamic-matrix-row__turn-trailing" />
  </article>
</template>

<script setup lang="ts">
import type { VirtualizerDynamicFixtureRow } from '../definitions/dynamicResizeMatrix';
import VirtualizerDynamicBlock from './VirtualizerDynamicBlock.vue';

defineProps<{
  row: VirtualizerDynamicFixtureRow;
}>();
</script>
