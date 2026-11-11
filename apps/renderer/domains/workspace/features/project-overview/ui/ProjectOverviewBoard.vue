<!--
  看板：按一个单选字段分列，没填的一列放最后。把卡片拖到另一列就是把它的这个字段改成那一列的值；
  写入由页面完成（经语义层、记进行动账本）。卡片是纸：直角、无边、贴地阴影。
-->
<template>
  <div
    ref="boardRef"
    class="project-overview-board"
    :class="{ 'is-dragging': drag?.active }"
    :style="{ '--project-overview-board-lanes': lanes.length }"
  >
    <section
      v-for="lane in lanes"
      :key="lane.key ?? UNSET"
      class="project-overview-board__lane"
      :class="{
        'project-overview-board__lane--unset': lane.key === null,
        'is-drop-target': isDropTarget(lane.key),
      }"
      :data-lane-key="laneKey(lane.key)"
      :aria-label="lane.name"
    >
      <p class="project-overview-board__head">
        <span class="project-overview-board__name">{{ lane.name }}</span>
        <span class="project-overview-board__count">{{ lane.rows.length }}</span>
      </p>
      <div class="project-overview-board__cards">
        <article
          v-for="row in lane.rows"
          :key="row.documentId"
          class="project-overview-board__card"
          :class="{ 'is-source': drag?.active && drag.row.documentId === row.documentId }"
          tabindex="0"
          :aria-label="row.title"
          @pointerdown="startDrag($event, row, lane.key)"
          @click.capture="swallowClickAfterDrag"
          @dblclick="emit('open', row)"
          @keydown.enter.self="emit('open', row)"
        >
          <button type="button" tabindex="-1" class="project-overview-board__title" @click="emit('open', row)">
            {{ row.title }}
          </button>
          <div v-if="row.tags.length > 0" class="project-overview-board__tags">
            <TagChip v-for="tag in row.tags" :key="tag.id" :label="tag.name" />
          </div>
          <p v-if="fieldsText(row)" class="project-overview-board__fields">{{ fieldsText(row) }}</p>
          <p class="project-overview-board__when">{{ whenText(row) }}</p>
        </article>
        <div v-if="isDropTarget(lane.key)" class="project-overview-board__placeholder" aria-hidden="true" />
      </div>
    </section>

    <Teleport to="body">
      <article
        v-if="drag?.active"
        class="project-overview-board__card project-overview-board__card--floating"
        :style="{ left: `${drag.x - drag.offsetX}px`, top: `${drag.y - drag.offsetY}px`, width: `${drag.width}px` }"
        aria-hidden="true"
      >
        <span class="project-overview-board__title">{{ drag.row.title }}</span>
        <div v-if="drag.row.tags.length > 0" class="project-overview-board__tags">
          <TagChip v-for="tag in drag.row.tags" :key="tag.id" :label="tag.name" />
        </div>
        <p v-if="fieldsText(drag.row)" class="project-overview-board__fields">{{ fieldsText(drag.row) }}</p>
        <p class="project-overview-board__when">{{ whenText(drag.row) }}</p>
      </article>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { ProjectOverviewField } from '@app/schemas';
import { TagChip } from '@linnya/renderer-ui';
import type { ProjectOverviewRow } from '../definitions/projectOverview';
import { boardCardFieldsText, type ProjectOverviewBoardLane } from '../functions/projectOverviewBoard';

const props = defineProps<{
  lanes: readonly ProjectOverviewBoardLane[];
  field: ProjectOverviewField;
  fields: readonly ProjectOverviewField[];
  readonly: boolean;
  whenText: (row: ProjectOverviewRow) => string;
}>();

const emit = defineEmits<{
  open: [row: ProjectOverviewRow];
  move: [row: ProjectOverviewRow, optionId: string | null];
}>();

const UNSET = '__unset__';
/** 指针移动超过这个距离才算拖动，否则是点击。 */
const DRAG_THRESHOLD_PX = 4;
const laneKey = (key: string | null): string => key ?? UNSET;
const fieldsText = computed(() => (row: ProjectOverviewRow) => boardCardFieldsText(row, props.fields, props.field.id));

interface DragState {
  readonly row: ProjectOverviewRow;
  readonly sourceKey: string;
  readonly startX: number;
  readonly startY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  x: number;
  y: number;
  active: boolean;
  dropKey: string | null;
}

/*
 * 用指针事件自己做拖动，不用系统拖放：拖起的卡片是一张微微倾斜、阴影加深的纸跟着指针走，
 * 原卡片调淡留在原处，目标列出现落点占位。松手落在另一列才改值，Esc 取消。
 */
const boardRef = ref<HTMLElement | null>(null);
const drag = ref<DragState | null>(null);
let suppressClick = false;

function isDropTarget(key: string | null): boolean {
  const state = drag.value;
  return state !== null && state.active && state.dropKey === laneKey(key) && state.sourceKey !== laneKey(key);
}

function laneAt(x: number): string | null {
  const lanes = boardRef.value?.querySelectorAll<HTMLElement>('.project-overview-board__lane') ?? [];
  for (const lane of lanes) {
    const rect = lane.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right) return lane.dataset.laneKey ?? null;
  }
  return null;
}

function startDrag(event: PointerEvent, row: ProjectOverviewRow, key: string | null): void {
  if (props.readonly || event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  const rect = event.currentTarget.getBoundingClientRect();
  drag.value = {
    row, sourceKey: laneKey(key), startX: event.clientX, startY: event.clientY,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width,
    x: event.clientX, y: event.clientY, active: false, dropKey: null,
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', onKey, true);
}

function onMove(event: PointerEvent): void {
  const state = drag.value;
  if (!state) return;
  state.x = event.clientX;
  state.y = event.clientY;
  if (!state.active && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD_PX) return;
  if (!state.active) {
    state.active = true;
    document.body.classList.add('project-overview-board-is-dragging');
  }
  state.dropKey = laneAt(event.clientX);
}

function onUp(): void {
  const state = drag.value;
  cleanup();
  if (!state?.active) return;
  suppressClick = true;
  if (state.dropKey !== null && state.dropKey !== state.sourceKey) {
    emit('move', state.row, state.dropKey === UNSET ? null : state.dropKey);
  }
}

function cancel(): void {
  if (drag.value?.active) suppressClick = true;
  cleanup();
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !drag.value?.active) return;
  event.preventDefault();
  event.stopPropagation();
  cancel();
}

/** 拖动结束时浏览器还会补一个 click，不能把它当成打开文档。 */
function swallowClickAfterDrag(event: MouseEvent): void {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function cleanup(): void {
  drag.value = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', cancel);
  window.removeEventListener('keydown', onKey, true);
  document.body.classList.remove('project-overview-board-is-dragging');
  // 没有补发 click（指针落在卡片外）时，下一轮清掉标记。
  setTimeout(() => { suppressClick = false; }, 0);
}

onBeforeUnmount(cleanup);
</script>
