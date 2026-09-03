<template>
  <v-group :config="groupConfig">
    <component
      :is="primitiveComponent"
      :config="instruction.config"
    />

    <KonvaTextNode
      v-if="node.innerText"
      :node="innerTextNode"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ShapeRenderNode, TextRenderNode } from '../../../../types/render';
import KonvaTextNode from './KonvaTextNode.vue';
import {
  buildInnerTextNode,
  buildShapeGroupConfig,
  buildShapeRenderInstruction,
  type KonvaShapePrimitive,
} from '../../../../features/konvaPreview';

const props = defineProps<{
  node: ShapeRenderNode;
}>();

const groupConfig = computed(() => buildShapeGroupConfig(props.node));

const instruction = computed(() => buildShapeRenderInstruction(props.node));

const PRIMITIVE_TO_VUE_COMPONENT: Record<KonvaShapePrimitive, string> = {
  rect: 'v-rect',
  ellipse: 'v-ellipse',
  line: 'v-line',
  path: 'v-path',
};

const primitiveComponent = computed(() => PRIMITIVE_TO_VUE_COMPONENT[instruction.value.primitive]);

const innerTextNode = computed<TextRenderNode>(() => buildInnerTextNode(props.node));
</script>
