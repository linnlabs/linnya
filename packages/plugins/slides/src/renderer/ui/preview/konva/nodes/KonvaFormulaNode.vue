<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <v-rect
      v-if="!props.imageResource"
      :__use-strict-mode="true"
      :config="placeholderConfig"
    />
    <v-image
      v-else
      :__use-strict-mode="true"
      :config="imageConfig"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MathFormulaRenderNode } from '../../../../types/render';
import type { LoadedRenderImage } from '../../../../features/renderImageResources';
import {
  buildFormulaGroupConfig,
  buildFormulaImageConfig,
  buildFormulaPlaceholderConfig,
} from '../../../../features/formulaRendering';

const props = defineProps<{
  node: MathFormulaRenderNode;
  imageResource: LoadedRenderImage | null;
}>();

const groupConfig = computed(() => buildFormulaGroupConfig(props.node));
const imageConfig = computed(() => props.imageResource
  ? buildFormulaImageConfig(props.node, props.imageResource)
  : {});
const placeholderConfig = computed(() => buildFormulaPlaceholderConfig(props.node));
</script>
