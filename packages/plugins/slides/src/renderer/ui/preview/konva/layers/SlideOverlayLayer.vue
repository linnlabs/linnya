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
        v-for="line in manualSelectionLineConfigs"
        :key="line.key"
        :__use-strict-mode="true"
        :config="line.config"
      />
      <v-line
        v-for="(guide, index) in snapGuideConfigs"
        :key="`guide-${index}`"
        :__use-strict-mode="true"
        :config="guide"
      />
      <v-rect
        v-for="box in pendingInsertionConfigs"
        :key="box.key"
        :__use-strict-mode="true"
        :config="box.config"
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
} from '../../../../features/manualEditing';

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
  manualSelectedTargets?: readonly ManualEditableTarget[];
  snapGuides?: readonly { readonly axis: 'x' | 'y'; readonly position: number; readonly from: number; readonly to: number }[];
  pendingInsertions?: readonly { readonly editKey: string; readonly box: SourceSelectionRect }[];
  slideSize: { readonly width: number; readonly height: number };
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

// 多选时成员框变淡，再画一个选区外框；浮条与对齐都以这个外框为准。
const manualSelectionLineConfigs = computed(() => {
  const targets = props.manualSelectedTargets ?? [];
  const multiple = targets.length > 1;
  const members = targets.map(target => ({
    key: target.elementId, config: { points: toPxPoints(target.polygon), closed: true,
      stroke: SLIDES_RENDER_COLORS.manualEditingStroke, strokeWidth: strokeWidth.value,
      opacity: multiple ? 0.5 : 1, fill: SLIDES_RENDER_COLORS.manualEditingFill, listening: false },
  }));
  if (!multiple) return members;
  const left = Math.min(...targets.map(target => target.bounds.x));
  const top = Math.min(...targets.map(target => target.bounds.y));
  const right = Math.max(...targets.map(target => target.bounds.x + target.bounds.w));
  const bottom = Math.max(...targets.map(target => target.bounds.y + target.bounds.h));
  return [...members, { key: 'selection-bounds', config: {
    points: toPxPoints(rectToPolygon({ x: left, y: top, w: right - left, h: bottom - top })), closed: true,
    stroke: SLIDES_RENDER_COLORS.manualEditingStroke, strokeWidth: strokeWidth.value, listening: false,
  } }];
});
// 吸附线用独立的品红实线，与蓝色选框区分；范围由吸附结果给出（对齐对象时只连接两者）。
const snapGuideConfigs = computed(() => (props.snapGuides ?? []).map(guide => ({
  points: guide.axis === 'x'
    ? [guide.position * INCHES_TO_PX, guide.from * INCHES_TO_PX, guide.position * INCHES_TO_PX, guide.to * INCHES_TO_PX]
    : [guide.from * INCHES_TO_PX, guide.position * INCHES_TO_PX, guide.to * INCHES_TO_PX, guide.position * INCHES_TO_PX],
  stroke: SLIDES_RENDER_COLORS.manualSnapGuide, strokeWidth: strokeWidth.value, listening: false,
})));

// 插入/粘贴还在保存时先画出落点，正式对象呈现后占位自然消失。
const pendingInsertionConfigs = computed(() => (props.pendingInsertions ?? []).map(({ editKey, box }) => ({
  key: editKey, config: { x: box.x * INCHES_TO_PX, y: box.y * INCHES_TO_PX, width: box.w * INCHES_TO_PX, height: box.h * INCHES_TO_PX,
    stroke: SLIDES_RENDER_COLORS.manualEditingStroke, strokeWidth: strokeWidth.value, dash: [6, 4],
    fill: SLIDES_RENDER_COLORS.manualEditingFill, listening: false },
})));

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
