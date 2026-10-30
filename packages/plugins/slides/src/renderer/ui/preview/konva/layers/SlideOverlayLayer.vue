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
        v-if="manualHoveredLineConfig"
        :__use-strict-mode="true"
        :config="manualHoveredLineConfig"
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
      <v-line
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
import { createSelectionOutlineGrid, SELECTION_OUTLINE_SOFT_OPACITY } from '../../../../shared/selectionOutline';
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
    dash?: readonly number[];
    fill?: string;
    opacity?: number;
    listening: false;
  };
}

const props = defineProps<{
  transform: { x: number; y: number; scaleX: number; scaleY: number };
  selectedTargets: readonly SourceSelectableElement[];
  hoveredTarget: SourceSelectableElement | null;
  /** 悬停的作者对象（已按预览投影）；已选中的不再重复画悬停框。 */
  manualHoveredTarget?: { readonly elementId: string; readonly polygon: readonly SourceSelectionPoint[] } | null;
  marqueeRect: SourceSelectionRect | null;
  manualSelectedTargets?: readonly ManualEditableTarget[];
  snapGuides?: readonly { readonly axis: 'x' | 'y'; readonly position: number; readonly from: number; readonly to: number }[];
  pendingInsertions?: readonly { readonly editKey: string; readonly box: SourceSelectionRect }[];
  slideSize: { readonly width: number; readonly height: number };
}>();

/** overlay 层默认不监听事件，按需在子组件内开启 */
const layerConfig = { listening: false };

// 标准见 shared/selectionOutline.ts：一种选择色、1 个屏幕像素、对齐设备像素。
const grid = computed(() => createSelectionOutlineGrid(props.transform.scaleX, window.devicePixelRatio || 1));
const stroke = SLIDES_RENDER_COLORS.selectionStroke;

function outline(polygon: readonly SourceSelectionPoint[], style: 'solid' | 'soft' | 'dashed', fill?: string) {
  return {
    points: toPxPoints(polygon), closed: true, stroke, strokeWidth: grid.value.strokeWidth,
    ...(style === 'soft' ? { opacity: SELECTION_OUTLINE_SOFT_OPACITY } : {}),
    ...(style === 'dashed' ? { dash: grid.value.dash } : {}),
    ...(fill ? { fill } : {}),
    listening: false as const,
  };
}

const selectedLineConfigs = computed<OverlayLineEntry[]>(() =>
  props.selectedTargets.map(target => ({ key: target.elementId, config: outline(target.polygon, 'solid') })),
);

const hoveredLineConfig = computed(() => {
  const target = props.hoveredTarget;
  if (!target || props.selectedTargets.some((selected) => selected.elementId === target.elementId)) {
    return null;
  }
  return outline(target.polygon, 'soft');
});

const manualHoveredLineConfig = computed(() => {
  const target = props.manualHoveredTarget;
  if (!target || (props.manualSelectedTargets ?? []).some(selected => selected.elementId === target.elementId)) return null;
  return outline(target.polygon, 'soft');
});

const marqueeLineConfig = computed(() => props.marqueeRect
  ? outline(rectToPolygon(props.marqueeRect), 'dashed', SLIDES_RENDER_COLORS.selectionMarqueeFill)
  : null);

// 多选时成员框变淡，再画一个选区外框；浮条与对齐都以这个外框为准。
const manualSelectionLineConfigs = computed<OverlayLineEntry[]>(() => {
  const targets = props.manualSelectedTargets ?? [];
  const multiple = targets.length > 1;
  const members = targets.map(target => ({ key: target.elementId, config: outline(target.polygon, multiple ? 'soft' : 'solid') }));
  if (!multiple) return members;
  const left = Math.min(...targets.map(target => target.bounds.x));
  const top = Math.min(...targets.map(target => target.bounds.y));
  const right = Math.max(...targets.map(target => target.bounds.x + target.bounds.w));
  const bottom = Math.max(...targets.map(target => target.bounds.y + target.bounds.h));
  return [...members, { key: 'selection-bounds', config: outline(rectToPolygon({ x: left, y: top, w: right - left, h: bottom - top }), 'solid') }];
});

// 吸附线用独立的品红实线，与选择色区分；范围由吸附结果给出（对齐对象时只连接两者）。
const snapGuideConfigs = computed(() => (props.snapGuides ?? []).map(guide => {
  const position = grid.value.snap(guide.position * INCHES_TO_PX);
  return {
    points: guide.axis === 'x'
      ? [position, guide.from * INCHES_TO_PX, position, guide.to * INCHES_TO_PX]
      : [guide.from * INCHES_TO_PX, position, guide.to * INCHES_TO_PX, position],
    stroke: SLIDES_RENDER_COLORS.manualSnapGuide, strokeWidth: grid.value.strokeWidth, listening: false,
  };
}));

// 插入/粘贴还在保存时先画出落点（虚线），正式对象呈现后占位自然消失。
const pendingInsertionConfigs = computed<OverlayLineEntry[]>(() => (props.pendingInsertions ?? [])
  .map(({ editKey, box }) => ({ key: editKey, config: outline(rectToPolygon(box), 'dashed') })));

function toPxPoints(points: readonly SourceSelectionPoint[]): number[] {
  const { snap } = grid.value;
  return points.flatMap((point) => [
    snap(point.x * INCHES_TO_PX),
    snap(point.y * INCHES_TO_PX),
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
