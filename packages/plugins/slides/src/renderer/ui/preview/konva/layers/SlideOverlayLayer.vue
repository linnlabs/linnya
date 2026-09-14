<template>
  <v-layer
    :__use-strict-mode="true"
    :config="layerConfig"
  >
    <v-group
      :__use-strict-mode="true"
      :config="transform"
    >
      <v-line
        v-if="hoveredLineConfig"
        :__use-strict-mode="true"
        :config="hoveredLineConfig"
      />
      <v-line
        v-for="line in selectedLineConfigs"
        :key="line.key"
        :__use-strict-mode="true"
        :config="line.config"
      />
      <v-line
        v-if="manualSelectionLineConfig"
        :__use-strict-mode="true"
        :config="manualSelectionLineConfig"
      />
      <v-line
        v-if="marqueeLineConfig"
        :__use-strict-mode="true"
        :config="marqueeLineConfig"
      />
    </v-group>
  </v-layer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  SourceSelectableElement,
  SourceSelectionPoint,
  SourceSelectionRect,
} from '../../../../features/sourceSelection';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
} from '../../../../features/manualEditing';
import {
  projectManualVisualPreviewsToSelectionPolygon,
  type ManualEditingVisualPreview,
} from '../../../../features/manualEditing/manualVisualProjection';

interface OverlayLineEntry {
  key: string;
  config: {
    points: number[];
    closed: boolean;
    stroke: string;
    strokeWidth: number;
    dash?: number[];
    fill?: string;
    listening: false;
  };
}

const props = defineProps<{
  transform: { x: number; y: number; scaleX: number; scaleY: number };
  selectedTargets: readonly SourceSelectableElement[];
  hoveredTarget: SourceSelectableElement | null;
  marqueeRect: SourceSelectionRect | null;
  manualSelectedTarget?: ManualEditableTarget | null;
  manualTranslationPreview?: ManualEditingTranslationPreview | null;
  manualVisualPreviews?: readonly ManualEditingVisualPreview[];
}>();

/** overlay 层默认不监听事件，按需在子组件内开启 */
const layerConfig = { listening: false };

const strokeWidth = computed(() =>
  Math.max(1.5 / Math.max(props.transform.scaleX, 0.001), 1),
);

const selectedLineConfigs = computed<OverlayLineEntry[]>(() =>
  props.selectedTargets.map((target) => ({
    key: target.elementId,
    config: {
      points: toPxPoints(target.polygon),
      closed: true,
      stroke: SLIDES_RENDER_COLORS.sourceSelectionStroke,
      strokeWidth: strokeWidth.value,
      listening: false,
    },
  })),
);

const hoveredLineConfig = computed(() => {
  const target = props.hoveredTarget;
  if (!target || props.selectedTargets.some((selected) => selected.elementId === target.elementId)) {
    return null;
  }
  return {
    points: toPxPoints(target.polygon),
    closed: true,
    stroke: SLIDES_RENDER_COLORS.sourceSelectionStroke,
    strokeWidth: strokeWidth.value,
    dash: [5, 4],
    fill: SLIDES_RENDER_COLORS.sourceSelectionHoverFill,
    listening: false,
  };
});

const marqueeLineConfig = computed(() => {
  if (!props.marqueeRect) {
    return null;
  }
  const points = rectToPolygon(props.marqueeRect);
  return {
    points: toPxPoints(points),
    closed: true,
    stroke: SLIDES_RENDER_COLORS.sourceSelectionStroke,
    strokeWidth: strokeWidth.value,
    dash: [6, 4],
    fill: SLIDES_RENDER_COLORS.sourceSelectionMarqueeFill,
    listening: false,
  };
});

const manualSelectionLineConfig = computed(() => {
  const target = props.manualSelectedTarget;
  if (!target) return null;
  const preview = props.manualTranslationPreview?.elementId === target.elementId
    ? props.manualTranslationPreview
    : null;
  const polygon = projectManualVisualPreviewsToSelectionPolygon(
    target,
    props.manualVisualPreviews ?? [],
  );
  return {
    points: toPxPoints(polygon.map(point => ({
      x: point.x + (preview?.dx ?? 0),
      y: point.y + (preview?.dy ?? 0),
    }))),
    closed: true,
    stroke: SLIDES_RENDER_COLORS.manualEditingStroke,
    strokeWidth: strokeWidth.value,
    fill: SLIDES_RENDER_COLORS.manualEditingFill,
    listening: false,
  };
});

function toPxPoints(points: readonly SourceSelectionPoint[]): number[] {
  return points.flatMap((point) => [
    point.x * INCHES_TO_PX,
    point.y * INCHES_TO_PX,
  ]);
}

function rectToPolygon(rect: SourceSelectionRect): readonly SourceSelectionPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}
</script>
