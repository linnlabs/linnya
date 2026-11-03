<template>
  <template v-if="anchors.length">
    <button
      v-for="anchor in anchors"
      :key="`${anchor.cardId}-${anchor.side}`"
      type="button"
      class="canvas-connection-anchor"
      :style="pointStyle(anchor)"
      :aria-label="`从卡片${sideNames[anchor.side]}侧开始连线`"
      @pointerdown.stop.prevent="editing.start({ kind: 'create', event: $event, from: { kind: 'card', cardId: anchor.cardId, side: anchor.side }, origin: anchor })"
    />
  </template>
  <div
    v-if="edge"
    ref="bar"
    class="canvas-connection-bar"
    :style="barStyle"
    role="toolbar"
    aria-label="所选连线"
    @pointerdown.stop
    @keydown.stop
  >
    <CustomSelect
      :model-value="edge.direction"
      :options="directions"
      title="连线方向"
      width="90px"
      min-width="90px"
      @update:model-value="setDirection"
    />
    <CustomSelect
      :model-value="edge.lineStyle"
      :options="styles"
      title="连线形状"
      width="70px"
      min-width="70px"
      @update:model-value="setStyle"
    />
    <CustomSelect
      :model-value="edge.linePattern"
      :options="patterns"
      title="连线笔触"
      width="70px"
      min-width="70px"
      @update:model-value="setPattern"
    />
    <CustomSelect
      :model-value="edge.color"
      :options="colors"
      title="连线颜色"
      width="64px"
      min-width="64px"
      @update:model-value="setColor"
    />
    <ToolbarButton
      label="编辑连线标签"
      :disabled="edge.locked"
      @click="run(editing.beginLabel)"
    >
      标签
    </ToolbarButton>
    <ToolbarButton
      :label="edge.locked ? '解锁连线' : '锁定连线'"
      @click="run(() => editing.patch(edge!, { locked: !edge!.locked }))"
    >
      {{ edge.locked ? '解锁' : '锁定' }}
    </ToolbarButton>
    <ToolbarButton
      label="反转连线方向"
      :disabled="edge.locked"
      @click="run(editing.reverse)"
    >
      反转
    </ToolbarButton>
    <ToolbarButton
      label="跳到连线起点"
      @click="emit('locate', 'from')"
    >
      起点
    </ToolbarButton>
    <ToolbarButton
      label="跳到连线终点"
      @click="emit('locate', 'to')"
    >
      终点
    </ToolbarButton>
    <ToolbarButton
      label="删除连线"
      :disabled="edge.locked"
      @click="run(editing.remove)"
    >
      删除
    </ToolbarButton>
  </div>
  <template v-if="edge && geometry">
    <button
      v-if="!edge.locked"
      type="button"
      class="canvas-connection-endpoint"
      :style="pointStyle(geometry.from)"
      aria-label="移动连线起点"
      @pointerdown.stop.prevent="editing.start({ kind: 'reattach', event: $event, from: edge.to, origin: geometry.to, edge, field: 'from' })"
    />
    <button
      v-if="!edge.locked"
      type="button"
      class="canvas-connection-endpoint"
      :style="pointStyle(geometry.to)"
      aria-label="移动连线终点"
      @pointerdown.stop.prevent="editing.start({ kind: 'reattach', event: $event, from: edge.from, origin: geometry.from, edge, field: 'to' })"
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
    >
  </template>
  <svg
    v-if="preview"
    class="canvas-connection-preview"
    aria-hidden="true"
  ><line
    :x1="preview.from.x"
    :y1="preview.from.y"
    :x2="preview.to.x"
    :y2="preview.to.y"
  /></svg>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue';
import { ToolbarButton, CustomSelect } from '@linnya/renderer-ui';
import { CanvasEdgeSchema, CanvasColorSchema, type CanvasCamera, type CanvasCard, type CanvasPoint } from '@plugin/canvas/shared';
import type { createCanvasConnectionEditing } from '../orchestration/createCanvasConnectionEditing';
import { canvasConnectionAnchors } from '../functions/canvasConnectionAnchors';
const props = defineProps<{ editing: ReturnType<typeof createCanvasConnectionEditing>; card: CanvasCard | null; camera: CanvasCamera; run: (action: () => Promise<unknown>) => Promise<void> }>();
const emit = defineEmits<{ focusCanvas: []; locate: [which: 'from' | 'to'] }>();
const bar = ref<HTMLElement | null>(null), barSize = ref({ width: 720, height: 44 });
const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) barSize.value = { width: entry.target.clientWidth, height: entry.target.clientHeight }; });
watch(bar, value => { observer.disconnect(); if (value) observer.observe(value); });
onBeforeUnmount(() => observer.disconnect());
const edge = computed(() => props.editing.selected.value), labelInput = ref<HTMLInputElement | null>(null);
const anchors = computed(() => {
  if (props.camera.zoom < 0.3) return [];
  const target = props.editing.state.preview.value?.target, cards = props.card && !props.card.locked ? [props.card] : [];
  if (target && !cards.some(card => card.id === target.id)) cards.push(target);
  return cards.flatMap(card => canvasConnectionAnchors(card).map(anchor => ({ ...anchor, cardId: card.id })));
});
const geometry = computed(() => { void props.camera; return props.editing.geometry(); });
const project = (point: CanvasPoint) => ({ x: props.camera.x + point.x * props.camera.zoom, y: props.camera.y + point.y * props.camera.zoom });
const pointStyle = (point: CanvasPoint) => { const screen = project(point); return { left: `${screen.x}px`, top: `${screen.y}px` }; };
const barStyle = computed(() => {
  const shape = geometry.value, host = bar.value?.parentElement; if (!shape || !host) return undefined;
  const point = props.editing.toolbarPosition({ geometry: shape, camera: props.camera, size: barSize.value, viewport: { width: host.clientWidth, height: host.clientHeight } });
  return { left: `${point.x}px`, top: `${point.y}px` };
});
const preview = computed(() => { const value = props.editing.state.preview.value; return value ? { from: project(value.from), to: project(value.to) } : null; });
const sideNames = { top: '上', right: '右', bottom: '下', left: '左' };
const directions = [{ value: 'none', text: '无箭头' }, { value: 'forward', text: '单向' }, { value: 'both', text: '双向' }], styles = [{ value: 'curve', text: '曲线' }, { value: 'straight', text: '直线' }], patterns = [{ value: 'solid', text: '实线' }, { value: 'dashed', text: '虚线' }];
const colors = [{ value: 'white', text: '原色' }, { value: 'red', text: '红' }, { value: 'orange', text: '橙' }, { value: 'yellow', text: '黄' }, { value: 'green', text: '绿' }, { value: 'cyan', text: '青' }, { value: 'purple', text: '紫' }];
const patch = (value: Parameters<typeof props.editing.patch>[1]) => props.run(async () => { const current = edge.value; if (current) await props.editing.patch(current, value); });
const setDirection = (value: string | number | boolean) => patch({ direction: CanvasEdgeSchema.shape.direction.parse(value) });
const setStyle = (value: string | number | boolean) => patch({ lineStyle: CanvasEdgeSchema.shape.lineStyle.parse(value) });
const setPattern = (value: string | number | boolean) => patch({ linePattern: CanvasEdgeSchema.shape.linePattern.parse(value) });
const setColor = (value: string | number | boolean) => patch({ color: CanvasColorSchema.parse(value) });
const updateLabel = (event: Event) => { if (event.target instanceof HTMLInputElement) props.editing.state.updateLabel(event.target.value); };
const finishLabel = () => props.run(async () => { if (await props.editing.saveLabel()) emit('focusCanvas'); });
watch(() => props.editing.state.label.value?.edge.id, async id => { if (id) { await nextTick(); labelInput.value?.focus(); labelInput.value?.select(); } });
</script>
