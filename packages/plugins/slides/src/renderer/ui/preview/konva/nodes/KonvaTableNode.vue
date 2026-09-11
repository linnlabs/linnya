<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <v-rect
      :__use-strict-mode="true"
      :config="tableBackgroundConfig"
    />

    <template
      v-for="layout in cellLayouts"
      :key="`${node.id}-${layout.cell.row}-${layout.cell.col}`"
    >
      <v-rect
        :__use-strict-mode="true"
        :config="cellRectConfig(layout)"
      />
      <KonvaTextNode :node="cellTextNode(layout)" />
    </template>

    <v-line
      v-for="(segment, index) in borderSegments"
      :key="`${node.id}-border-${index}`"
      :__use-strict-mode="true"
      :config="borderConfig(segment)"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TableRenderNode, TextRenderNode } from '../../../../types/render';
import {
  buildTableBorderSegments,
  buildTableCellLayouts,
  type TableCellLayout,
} from '../../../../features/konvaPreview';
import {
  buildCellBorderConfig,
  buildCellRectConfig,
  buildCellTextNode,
  buildTableBackgroundConfig,
  buildTableGroupConfig,
} from '../../../../features/konvaPreview';
import KonvaTextNode from './KonvaTextNode.vue';

const props = defineProps<{
  node: TableRenderNode;
}>();

const groupConfig = computed(() => buildTableGroupConfig(props.node));
const cellLayouts = computed(() => buildTableCellLayouts(props.node));
const borderSegments = computed(() => buildTableBorderSegments(props.node));
const tableBackgroundConfig = computed(() => buildTableBackgroundConfig(props.node));

function cellRectConfig(layout: TableCellLayout) {
  return buildCellRectConfig(props.node, layout);
}

function cellTextNode(layout: TableCellLayout): TextRenderNode {
  return buildCellTextNode(props.node, layout);
}

const borderConfig = buildCellBorderConfig;
</script>
