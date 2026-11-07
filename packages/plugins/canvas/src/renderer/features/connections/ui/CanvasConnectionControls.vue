<template>
  <template v-if="anchors.length">
    <button
      v-for="anchor in anchors"
      :key="`${anchor.cardId}-${anchor.side}`"
      type="button"
      class="canvas-connection-anchor"
      :style="pointStyle(anchor)"
      :aria-label="`从卡片${sideNames[anchor.side]}侧开始连线`"
      @pointerdown.stop.prevent="
        editing.start({
          kind: 'create',
          event: $event,
          from: { kind: 'card', cardId: anchor.cardId, side: anchor.side },
          origin: anchor,
        })
      "
    />
  </template>
  <FloatingToolbar
    v-if="edge && !menuOpen"
    ref="bar"
    :show="true"
    :position="barPosition"
    class="canvas-connection-bar"
    role="toolbar"
    aria-label="所选连线"
    @pointerdown.stop
    @keydown.stop
  >
    <ToolbarGroup>
      <CanvasToolbarMenu
        label="连线样式"
        :options="styleOptions"
        :disabled="edge.locked"
        :show-selected-checkmark="true"
        min-width="150px"
        @select="setStyleOption"
      >
        <LineIcon
          :arrows="edge.direction === 'forward' ? 'end' : edge.direction"
          :dashed="edge.linePattern === 'dashed'"
        />
      </CanvasToolbarMenu>
      <CanvasToolbarMenu
        label="连线颜色"
        :options="colorOptions"
        :model-value="edge.color"
        :disabled="edge.locked"
        :show-selected-checkmark="true"
        min-width="140px"
        @select="setColor"
      >
        <CanvasColorSwatch :color="edge.color" />
      </CanvasToolbarMenu>
    </ToolbarGroup>
    <ToolbarGroup>
      <ToolbarButton label="编辑连线标签" :disabled="edge.locked" @click="run(editing.beginLabel)">
        <TagIcon />
      </ToolbarButton>
      <ToolbarButton label="删除连线" :disabled="edge.locked" @click="run(editing.remove)">
        <DeleteIcon />
      </ToolbarButton>
      <CanvasToolbarMenu
        label="更多连线操作"
        :options="moreOptions"
        align="end"
        :arrow="false"
        @select="more"
      >
        <MoreIcon />
      </CanvasToolbarMenu>
    </ToolbarGroup>
  </FloatingToolbar>
  <template v-if="edge && geometry">
    <button
      v-if="!edge.locked"
      type="button"
      class="canvas-connection-endpoint"
      :style="pointStyle(geometry.from)"
      aria-label="移动连线起点"
      @pointerdown.stop.prevent="
        editing.start({
          kind: 'reattach',
          event: $event,
          from: edge.to,
          origin: geometry.to,
          edge,
          field: 'from',
        })
      "
    />
    <button
      v-if="!edge.locked"
      type="button"
      class="canvas-connection-endpoint"
      :style="pointStyle(geometry.to)"
      aria-label="移动连线终点"
      @pointerdown.stop.prevent="
        editing.start({
          kind: 'reattach',
          event: $event,
          from: edge.from,
          origin: geometry.from,
          edge,
          field: 'to',
        })
      "
    />
    <input
      v-if="editing.state.label.value"
      ref="labelInput"
      class="canvas-connection-label-input"
      :style="pointStyle(geometry.midpoint)"
      :value="editing.state.label.value.value"
      aria-label="连线标签"
      @input="updateLabel"
      @blur="run(editing.saveLabel)"
      @keydown.enter.prevent="finishLabel"
      @keydown.esc.prevent.stop="finishLabel"
      @keydown.stop
      @pointerdown.stop
    />
  </template>
  <svg v-if="preview" class="canvas-connection-preview" aria-hidden="true">
    <line :x1="preview.from.x" :y1="preview.from.y" :x2="preview.to.x" :y2="preview.to.y" />
  </svg>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue';
import {
  FloatingToolbar,
  ToolbarButton,
  ToolbarGroup,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import { DeleteIcon, MoreIcon, TagIcon } from '@linnya/renderer-ui/icons';
import {
  CanvasColorSwatch,
  CanvasToolbarMenu,
  canvasColorSwatchOptions,
  canvasMenuIcons,
} from '../../canvasChrome';
import LineIcon from '../../../icon/LineIcon.vue';
import {
  CanvasEdgeSchema,
  CanvasColorSchema,
  type CanvasCamera,
  type CanvasCard,
  type CanvasPoint,
} from '@plugin/canvas/shared';
import type { createCanvasConnectionEditing } from '../orchestration/createCanvasConnectionEditing';
import { canvasConnectionAnchors } from '../functions/canvasConnectionAnchors';
const props = defineProps<{
  editing: ReturnType<typeof createCanvasConnectionEditing>;
  card: CanvasCard | null;
  camera: CanvasCamera;
  run: (action: () => Promise<unknown>) => Promise<void>;
  /** 右键菜单打开时收起连线浮条，与卡片选区浮条一致。 */
  menuOpen: boolean;
}>();
const emit = defineEmits<{ focusCanvas: []; locate: [which: 'from' | 'to'] }>();
const moreOptions = computed<readonly CustomSelectOption<string>[]>(() => [
  { value: 'lock', text: edge.value?.locked ? '解锁连线' : '锁定连线' },
  { value: 'reverse', text: '反转方向', disabled: Boolean(edge.value?.locked) },
  { isSeparator: true },
  { value: 'from', text: '跳到起点' },
  { value: 'to', text: '跳到终点' },
]);
const more = (value: string) => {
  const current = edge.value;
  if (!current) return;
  if (value === 'lock')
    void props.run(() => props.editing.patch(current, { locked: !current.locked }));
  else if (value === 'reverse') void props.run(props.editing.reverse);
  else if (value === 'from' || value === 'to') emit('locate', value);
};
const bar = ref<InstanceType<typeof FloatingToolbar> | null>(null),
  barSize = ref({ width: 720, height: 44 });
const observer = new ResizeObserver(entries => {
  const entry = entries[0];
  if (entry) barSize.value = { width: entry.target.clientWidth, height: entry.target.clientHeight };
});
const barElement = computed(() => bar.value?.element ?? null);
watch(barElement, value => {
  observer.disconnect();
  if (value) observer.observe(value);
});
onBeforeUnmount(() => observer.disconnect());
const edge = computed(() => props.editing.selected.value),
  labelInput = ref<HTMLInputElement | null>(null);
const anchors = computed(() => {
  if (props.camera.zoom < 0.3) return [];
  const target = props.editing.state.preview.value?.target,
    cards = props.card && !props.card.locked ? [props.card] : [];
  if (target && !cards.some(card => card.id === target.id)) cards.push(target);
  const inset = props.editing.anchorInset(props.camera.zoom);
  return cards.flatMap(card =>
    canvasConnectionAnchors(card, inset).map(anchor => ({ ...anchor, cardId: card.id }))
  );
});
const geometry = computed(() => {
  void props.camera;
  return props.editing.geometry();
});
const project = (point: CanvasPoint) => ({
  x: props.camera.x + point.x * props.camera.zoom,
  y: props.camera.y + point.y * props.camera.zoom,
});
const pointStyle = (point: CanvasPoint) => {
  const screen = project(point);
  return { left: `${screen.x}px`, top: `${screen.y}px` };
};
const barPosition = computed(() => {
  const shape = geometry.value,
    host = barElement.value?.parentElement;
  if (!shape || !host) return { top: 0, left: 0 };
  const point = props.editing.toolbarPosition({
    geometry: shape,
    camera: props.camera,
    size: barSize.value,
    viewport: { width: host.clientWidth, height: host.clientHeight },
  });
  return { left: point.x, top: point.y };
});
const preview = computed(() => {
  const value = props.editing.state.preview.value;
  return value ? { from: project(value.from), to: project(value.to) } : null;
});
const sideNames = { top: '上', right: '右', bottom: '下', left: '左' };
const styleGroups = [
  {
    label: '方向',
    field: 'direction',
    items: [
      { value: 'none', text: '无箭头' },
      { value: 'forward', text: '单向' },
      { value: 'both', text: '双向' },
    ],
  },
  {
    label: '线形',
    field: 'lineStyle',
    items: [
      { value: 'curve', text: '曲线' },
      { value: 'straight', text: '直线' },
    ],
  },
  {
    label: '笔触',
    field: 'linePattern',
    items: [
      { value: 'solid', text: '实线' },
      { value: 'dashed', text: '虚线' },
    ],
  },
] as const;
/** 方向、线形、笔触合成一个分组菜单，每组各自标出当前值。 */
const styleOptions = computed<readonly CustomSelectOption<string>[]>(() => {
  const current = edge.value;
  return styleGroups.flatMap((group, index) => [
    ...(index ? [{ isSeparator: true }] : []),
    { isGroup: true, label: group.label },
    ...group.items.map(item => ({
      value: `${group.field}:${item.value}`,
      text: item.text,
      iconComponent: canvasMenuIcons[`${group.field}:${item.value}`],
      selected: current?.[group.field] === item.value,
    })),
  ]);
});
const colorOptions = canvasColorSwatchOptions([
  { color: 'white', text: '原色' },
  { color: 'red', text: '红' },
  { color: 'orange', text: '橙' },
  { color: 'yellow', text: '黄' },
  { color: 'green', text: '绿' },
  { color: 'cyan', text: '青' },
  { color: 'purple', text: '紫' },
]);
const patch = (value: Parameters<typeof props.editing.patch>[1]) =>
  props.run(async () => {
    const current = edge.value;
    if (current) await props.editing.patch(current, value);
  });
const setStyleOption = (option: string) => {
  const [field, value] = option.split(':');
  if (field === 'direction')
    void patch({ direction: CanvasEdgeSchema.shape.direction.parse(value) });
  else if (field === 'lineStyle')
    void patch({ lineStyle: CanvasEdgeSchema.shape.lineStyle.parse(value) });
  else if (field === 'linePattern')
    void patch({ linePattern: CanvasEdgeSchema.shape.linePattern.parse(value) });
};
const setColor = (value: string) => void patch({ color: CanvasColorSchema.parse(value) });
const updateLabel = (event: Event) => {
  if (event.target instanceof HTMLInputElement) props.editing.state.updateLabel(event.target.value);
};
const finishLabel = () =>
  props.run(async () => {
    if (await props.editing.saveLabel()) emit('focusCanvas');
  });
watch(
  () => props.editing.state.label.value?.edge.id,
  async id => {
    if (id) {
      await nextTick();
      labelInput.value?.focus();
      labelInput.value?.select();
    }
  }
);
</script>
