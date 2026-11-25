<!--
  表格行列柄（二期结构入口）。
  - 只在指针所在的那一列、那一行出现一个柄；靠近分界出插入点，最后一行、最后一列附近出末尾加号。
  - 点柄选中整列 / 整行并打开菜单；拖柄移动行列；菜单与拖动期间声明 table-structure-edit 保活。
  - Teleport 到 body 用视口坐标定位，与单元格选中柄同一坐标系（见 TableBlock README）。
  - 只读、Pending、Table AI 模式下不出现。
-->
<template>
  <Teleport to="body">
    <div
      v-if="layout"
      class="table-structure-chrome"
      :class="{ 'is-dragging': drag !== null }"
    >
      <button
        v-for="item in layout.columnHandles"
        :key="`column-${item.index}`"
        type="button"
        class="table-structure-handle table-structure-handle--column"
        :class="{ 'is-active': item.active }"
        :style="item.style"
        :aria-label="editorMessage('editor.tableBlock.structure.columnHandle', { index: item.index + 1 })"
        @pointerdown="onHandlePointerDown($event, 'column', item.index)"
        @mousedown.prevent
        @mouseenter="highlight = { axis: 'column', index: item.index }"
        @mouseleave="highlight = null"
      >
        <svg viewBox="0 0 12 8" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="10" cy="2" r="1" /><circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" /><circle cx="10" cy="6" r="1" /></g></svg>
      </button>
      <button
        v-for="item in layout.rowHandles"
        :key="`row-${item.index}`"
        type="button"
        class="table-structure-handle table-structure-handle--row"
        :class="{ 'is-active': item.active }"
        :style="item.style"
        :aria-label="rowHandleLabel(item.index)"
        @pointerdown="onHandlePointerDown($event, 'row', item.index)"
        @mousedown.prevent
        @mouseenter="highlight = { axis: 'row', index: item.index }"
        @mouseleave="highlight = null"
      >
        <svg viewBox="0 0 8 12" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" /><circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" /></g></svg>
      </button>

      <template v-if="layout.insert">
        <div
          class="table-structure-line"
          :class="{ 'is-visible': insertHover }"
          :style="layout.insert.lineStyle"
        />
        <button
          type="button"
          class="table-structure-insert"
          :style="layout.insert.style"
          :aria-label="layout.insert.axis === 'column'
            ? editorMessage('editor.tableBlock.structure.insertColumnHere')
            : editorMessage('editor.tableBlock.structure.insertRowHere')"
          @mouseenter="insertHover = true"
          @mouseleave="insertHover = false"
          @pointerdown.prevent
          @mousedown.prevent
          @click="insertAt(layout.insert.axis, layout.insert.index)"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" /></svg>
        </button>
      </template>

      <template
        v-for="chip in layout.appends"
        :key="chip.axis"
      >
        <div
          class="table-structure-line"
          :class="{ 'is-visible': appendHover === chip.axis }"
          :style="chip.lineStyle"
        />
        <button
          type="button"
          class="table-structure-insert"
          :style="chip.style"
          :aria-label="chip.axis === 'column'
            ? editorMessage('editor.tableBlock.structure.appendColumn')
            : editorMessage('editor.tableBlock.structure.appendRow')"
          @mouseenter="appendHover = chip.axis"
          @mouseleave="appendHover = null"
          @pointerdown.prevent
          @mousedown.prevent
          @click="insertAt(chip.axis, chip.axis === 'column' ? columnCount : rowCount)"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" /></svg>
        </button>
      </template>

      <div
        v-for="(style, index) in layout.highlights"
        :key="`highlight-${index}`"
        class="table-structure-highlight"
        :style="style"
      />
      <div
        v-if="layout.dropLine"
        class="table-structure-drop-line"
        :style="layout.dropLine"
      />
    </div>

    <div
      v-if="menu"
      ref="menuWrapper"
      class="table-structure-menu"
      :style="menuStyle"
      @click.stop
      @contextmenu.prevent.stop
    >
      <CustomSelect
        :model-value="null"
        :options="menuOptions"
        :manual-mode="true"
        :parent-is-open="true"
        semantic-role="menu"
        variant="default"
        min-width="188px"
        @update:model-value="onMenuSelect"
        @close="dismissMenu"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, unref, watch } from 'vue';
import type { Ref } from 'vue';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { CustomSelect, measureFloatingLayoutSize, onNextFrame, useFrameBatch, type CustomSelectOption } from '@linnya/renderer-ui';
import { useNotificationStore } from '@/app/notification';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { useTableAiModeStore } from '../../../features/table-ai-mode';
import { floatingToolbarService } from '../../../features/floating-toolbar/service';
import { alignCellCenter, alignCellLeft, alignCellRight } from '../commands/tableAlignCommands';
import { deleteColumnByIndex, deleteRow } from '../commands/tableDeleteCommands';
import { useTableAiInteraction } from './composables/useTableAiInteraction';
import { useTableRenderVirtualizationKeepAlive } from './composables/useTableRenderVirtualizationKeepAlive';
import {
  clearTableColumnWidth,
  insertTableColumnAtIndex,
  insertTableRowAtIndex,
  moveTableColumn,
  moveTableRow,
  setTableAxisSelection,
  tableColumnHasStoredWidth,
  tableHasHeaderRow,
  toggleTableHeaderRow,
  type TableAxis,
} from '../structure/tableStructureCommands';
import {
  EMPTY_TABLE_HOVER,
  isPointNearTable,
  measureTableStructure,
  visibleTableEdges,
  resolveDropBoundary,
  resolveTableStructureHover,
  type TableBand,
  type TableStructureGeometry,
  type TableStructureHover,
} from '../structure/tableStructureGeometry';

interface Props {
  editor: Editor | Ref<Editor | null> | null;
}

interface ActiveTable {
  readonly element: HTMLTableElement;
  readonly pos: number;
  readonly node: ProseMirrorNode;
  readonly geometry: TableStructureGeometry;
  /** 编辑器可见区域的上下界，滚出可见区的柄不画在其他界面上。 */
  readonly viewport: TableBand;
}

interface MenuState {
  readonly axis: TableAxis;
  readonly index: number;
  readonly anchor: HTMLElement;
}

interface DragState {
  readonly axis: TableAxis;
  readonly from: number;
  readonly boundary: number | null;
}

const props = defineProps<Props>();
const editorValue = computed(() => unref(props.editor));
const { editorMessage } = useEditorLocalization();
const notifications = useNotificationStore();
const tableAiModeStore = useTableAiModeStore();

const active = shallowRef<ActiveTable | null>(null);
const hover = shallowRef<TableStructureHover>(EMPTY_TABLE_HOVER);
const menu = shallowRef<MenuState | null>(null);
const drag = shallowRef<DragState | null>(null);
const highlight = shallowRef<{ axis: TableAxis; index: number } | null>(null);
const insertHover = ref(false);
const appendHover = ref<TableAxis | null>(null);
const selectionVersion = ref(0);
const menuWrapper = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({ position: 'fixed', top: '0px', left: '0px' });

const columnCount = computed(() => active.value?.geometry.columns.length ?? 0);
const rowCount = computed(() => active.value?.geometry.rows.length ?? 0);

let pointer: { x: number; y: number } | null = null;

/* ---------- 资格：只读、Pending、AI 模式下不出现 ---------- */

function isEligibleTable(editor: Editor, table: HTMLTableElement): boolean {
  if (!editor.isEditable || tableAiModeStore.isActive) return false;
  if (!editor.view.dom.contains(table)) return false;
  if (table.closest('[contenteditable="false"]')) return false;
  const outer = table.closest('.root-block-outer');
  const revisionHeader = outer?.querySelector('[data-root-block-shell-revision-header]');
  return !revisionHeader || revisionHeader.childElementCount === 0;
}

function resolveTablePos(editor: Editor, table: HTMLTableElement): number | null {
  const cell = table.querySelector('td, th');
  if (!cell) return null;
  try {
    const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === 'table') return $pos.before(depth);
    }
  } catch {
    return null;
  }
  return null;
}

function measure(editor: Editor, element: HTMLTableElement): ActiveTable | null {
  const pos = resolveTablePos(editor, element);
  const node = pos === null ? null : editor.state.doc.nodeAt(pos);
  if (pos === null || !node) return null;
  const geometry = measureTableStructure({
    table: node,
    tableElement: element,
    cellElementAt: offset => {
      const dom = editor.view.nodeDOM(pos + 1 + offset);
      return dom instanceof Element ? dom : null;
    },
    scroller: element.closest('.root-block > .content') as HTMLElement | null,
  });
  if (!geometry) return null;
  const shell = editor.view.dom.closest('.editor-shell') ?? editor.view.dom;
  const shellRect = shell.getBoundingClientRect();
  return { element, pos, node, geometry, viewport: { start: shellRect.top, end: shellRect.bottom } };
}

/* ---------- 指针跟踪（下一帧合批） ---------- */

function refresh(): void {
  const editor = editorValue.value;
  if (!editor || editor.isDestroyed) {
    active.value = null;
    return;
  }
  if (menu.value || drag.value) {
    // 菜单或拖动期间只重新测量当前表，不切换目标。
    if (active.value?.element.isConnected) active.value = measure(editor, active.value.element) ?? active.value;
    return;
  }
  const target = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
  const hovered = target?.closest('table.table-block') as HTMLTableElement | null;
  let element: HTMLTableElement | null = null;
  if (hovered && isEligibleTable(editor, hovered)) element = hovered;
  else if (active.value?.element.isConnected && isEligibleTable(editor, active.value.element)) element = active.value.element;
  if (!element) {
    active.value = selectedTableElement(editor);
    hover.value = EMPTY_TABLE_HOVER;
    return;
  }
  const next = measure(editor, element);
  if (!next || !pointer || !isPointNearTable(next.geometry, pointer.x, pointer.y)) {
    active.value = selectedTableElement(editor);
    hover.value = EMPTY_TABLE_HOVER;
    return;
  }
  active.value = next;
  hover.value = resolveTableStructureHover(next.geometry, pointer.x, pointer.y);
}

/** 整行 / 整列选中后，指针离开表格时柄仍保持（选中态）。 */
function selectedTableElement(editor: Editor): ActiveTable | null {
  const selected = readAxisSelection(editor);
  if (!selected) return null;
  const dom = editor.view.nodeDOM(selected.tablePos);
  const element = dom instanceof HTMLElement ? dom.querySelector('table.table-block') : null;
  if (!(element instanceof HTMLTableElement) || !isEligibleTable(editor, element)) return null;
  return measure(editor, element);
}

const refreshBatch = useFrameBatch(refresh);

function schedule(): void {
  refreshBatch.request();
}

function onPointerMove(event: PointerEvent): void {
  pointer = { x: event.clientX, y: event.clientY };
  schedule();
}

function onScroll(): void {
  if (menu.value) closeMenu();
  if (active.value) schedule();
}

/* ---------- 选中态 ---------- */

interface AxisSelection {
  readonly tablePos: number;
  readonly axis: TableAxis;
  readonly index: number;
}

/** 当前选区恰好是一整列或一整行时返回它，柄据此显示为选中态。 */
function readAxisSelection(editor: Editor): AxisSelection | null {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return null;
  const $cell = selection.$anchorCell;
  const tablePos = $cell.before(-1);
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return null;
  const map = TableMap.get(table);
  const rect = map.rectBetween(selection.$anchorCell.pos - tablePos - 1, selection.$headCell.pos - tablePos - 1);
  if (selection.isColSelection() && rect.right - rect.left === 1) return { tablePos, axis: 'column', index: rect.left };
  if (selection.isRowSelection() && rect.bottom - rect.top === 1) return { tablePos, axis: 'row', index: rect.top };
  return null;
}

const axisSelection = computed(() => {
  const version = selectionVersion.value;
  const editor = editorValue.value;
  return version >= 0 && editor && !editor.isDestroyed ? readAxisSelection(editor) : null;
});

/* ---------- 布局 ---------- */

const HANDLE = Object.freeze({ long: 20, short: 12, outset: 6 });
const INSERT_SIZE = 16;

function px(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

const layout = computed(() => {
  const table = active.value;
  if (!table) return null;
  const { geometry, viewport } = table;
  const selected = axisSelection.value?.tablePos === table.pos ? axisSelection.value : null;
  const inView = (y: number) => y >= viewport.start && y <= viewport.end;
  const columnVisible = (band: TableBand) => {
    const center = (band.start + band.end) / 2;
    return center >= geometry.visible.start && center <= geometry.visible.end;
  };
  const columnIndexes = new Set<number>();
  if (hover.value.column !== null) columnIndexes.add(hover.value.column);
  if (selected?.axis === 'column') columnIndexes.add(selected.index);
  if (menu.value?.axis === 'column') columnIndexes.add(menu.value.index);
  const rowIndexes = new Set<number>();
  if (hover.value.row !== null) rowIndexes.add(hover.value.row);
  if (selected?.axis === 'row') rowIndexes.add(selected.index);
  if (menu.value?.axis === 'row') rowIndexes.add(menu.value.index);
  const quiet = drag.value !== null || menu.value !== null;
  // 横向滚动时表格左右可能滚出容器：行方向的柄、插入点、高亮与落点线都按可见范围画。
  const edges = visibleTableEdges(geometry);

  const columnHandles = [...columnIndexes]
    .filter(index => geometry.columns[index] && columnVisible(geometry.columns[index]!) && inView(geometry.top))
    .filter(index => !quiet || menu.value?.axis === 'column' && menu.value.index === index || selected?.axis === 'column' && selected.index === index)
    .map(index => {
      const band = geometry.columns[index]!;
      return {
        index,
        active: (selected?.axis === 'column' && selected.index === index) || (menu.value?.axis === 'column' && menu.value.index === index),
        style: { left: px((band.start + band.end) / 2 - HANDLE.long / 2), top: px(geometry.top - HANDLE.outset) },
      };
    });
  const rowHandles = [...rowIndexes]
    .filter(index => geometry.rows[index] && inView((geometry.rows[index]!.start + geometry.rows[index]!.end) / 2))
    .filter(index => !quiet || menu.value?.axis === 'row' && menu.value.index === index || selected?.axis === 'row' && selected.index === index)
    .map(index => {
      const band = geometry.rows[index]!;
      return {
        index,
        active: (selected?.axis === 'row' && selected.index === index) || (menu.value?.axis === 'row' && menu.value.index === index),
        style: { left: px(edges.left - HANDLE.outset), top: px((band.start + band.end) / 2 - HANDLE.long / 2) },
      };
    });

  let insert: { axis: TableAxis; index: number; style: Record<string, string>; lineStyle: Record<string, string> } | null = null;
  if (!quiet && hover.value.insertColumnAt !== null) {
    const edge = geometry.columns[hover.value.insertColumnAt - 1]!.end;
    insert = {
      axis: 'column',
      index: hover.value.insertColumnAt,
      style: { left: px(edge - INSERT_SIZE / 2), top: px(geometry.top - INSERT_SIZE / 2) },
      lineStyle: { left: px(edge - 1), top: px(geometry.top), width: '2px', height: px(geometry.bottom - geometry.top) },
    };
  } else if (!quiet && hover.value.insertRowAt !== null) {
    const edge = geometry.rows[hover.value.insertRowAt - 1]!.end;
    insert = {
      axis: 'row',
      index: hover.value.insertRowAt,
      style: { left: px(edges.left - INSERT_SIZE / 2), top: px(edge - INSERT_SIZE / 2) },
      lineStyle: { left: px(edges.left), top: px(edge - 1), width: px(edges.right - edges.left), height: '2px' },
    };
  }

  // 末尾加号与插入点同一形式：骑在下边框、右边框的中点，悬停时画出插入位置线，不占表格外的空间。
  const appends: { axis: TableAxis; style: Record<string, string>; lineStyle: Record<string, string> }[] = [];
  const visibleLeft = edges.left;
  const visibleRight = edges.right;
  if (!quiet && hover.value.appendRow && inView(geometry.bottom)) {
    appends.push({
      axis: 'row',
      style: { left: px((visibleLeft + visibleRight) / 2 - INSERT_SIZE / 2), top: px(geometry.bottom - INSERT_SIZE / 2) },
      lineStyle: { left: px(visibleLeft), top: px(geometry.bottom - 1), width: px(visibleRight - visibleLeft), height: '2px' },
    });
  }
  const bodyTop = geometry.rows.length > 1 ? geometry.rows[1]!.start : geometry.top;
  if (!quiet && hover.value.appendColumn && geometry.right <= geometry.visible.end + 1) {
    appends.push({
      axis: 'column',
      style: { left: px(geometry.right - INSERT_SIZE / 2), top: px((bodyTop + geometry.bottom) / 2 - INSERT_SIZE / 2) },
      lineStyle: { left: px(geometry.right - 1), top: px(geometry.top), width: '2px', height: px(geometry.bottom - geometry.top) },
    });
  }

  const highlights: Record<string, string>[] = [];
  const mark = highlight.value;
  if (mark && !quiet) {
    const band = mark.axis === 'column' ? geometry.columns[mark.index] : geometry.rows[mark.index];
    if (band) {
      const start = Math.max(band.start, edges.left);
      const end = Math.min(band.end, edges.right);
      highlights.push(mark.axis === 'column'
        ? { left: px(start), top: px(geometry.top), width: px(Math.max(0, end - start)), height: px(geometry.bottom - geometry.top) }
        : { left: px(edges.left), top: px(band.start), width: px(edges.right - edges.left), height: px(band.end - band.start) });
    }
  }

  let dropLine: Record<string, string> | null = null;
  const dragging = drag.value;
  if (dragging && dragging.boundary !== null) {
    const bands = dragging.axis === 'column' ? geometry.columns : geometry.rows;
    const edge = dragging.boundary === 0 ? bands[0]!.start : bands[dragging.boundary - 1]!.end;
    dropLine = dragging.axis === 'column'
      ? { left: px(edge - 1.5), top: px(geometry.top - 6), width: '3px', height: px(geometry.bottom - geometry.top + 12) }
      : { left: px(edges.left - 6), top: px(edge - 1.5), width: px(edges.right - edges.left + 12), height: '3px' };
  }

  return { columnHandles, rowHandles, insert, appends, highlights, dropLine };
});

/* ---------- 命令 ---------- */

function run(build: (tr: Editor['state']['tr'], tablePos: number) => boolean): boolean {
  const editor = editorValue.value;
  const table = active.value;
  if (!editor || editor.isDestroyed || !table) return false;
  const tr = editor.state.tr;
  if (!build(tr, table.pos)) return false;
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

function insertAt(axis: TableAxis, index: number): void {
  insertHover.value = false;
  appendHover.value = null;
  run((tr, tablePos) => axis === 'column'
    ? insertTableColumnAtIndex(tr, tablePos, index)
    : insertTableRowAtIndex(tr, tablePos, index));
}

function selectAxis(axis: TableAxis, index: number): boolean {
  return run((tr, tablePos) => setTableAxisSelection(tr, tablePos, axis, index));
}

function rowHandleLabel(index: number): string {
  const table = active.value?.node;
  return index === 0 && table && tableHasHeaderRow(table)
    ? editorMessage('editor.tableBlock.structure.headerRowHandle')
    : editorMessage('editor.tableBlock.structure.rowHandle', { index: index + 1 });
}

/* ---------- 柄：点击选中并开菜单，拖动移动 ---------- */

const DRAG_THRESHOLD = 4;

function onHandlePointerDown(event: PointerEvent, axis: TableAxis, index: number): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  const start = { x: event.clientX, y: event.clientY };
  let dragging = false;
  handle.setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent) => {
    const table = active.value;
    if (!table) return;
    if (!dragging) {
      if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) <= DRAG_THRESHOLD) return;
      if (axis === 'row' && index === 0 && tableHasHeaderRow(table.node)) {
        notifications.show(editorMessage('editor.tableBlock.structure.headerRowFixed'), 'info', 2000);
        finish();
        return;
      }
      dragging = true;
      closeMenu();
      selectAxis(axis, index);
    }
    const bands = axis === 'column' ? table.geometry.columns : table.geometry.rows;
    let boundary = resolveDropBoundary(bands, axis === 'column' ? moveEvent.clientX : moveEvent.clientY, index);
    if (axis === 'row' && boundary === 0 && tableHasHeaderRow(table.node)) boundary = null;
    drag.value = { axis, from: index, boundary };
  };
  const finish = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  const onCancel = () => {
    finish();
    drag.value = null;
  };
  const onUp = () => {
    finish();
    const current = drag.value;
    drag.value = null;
    if (!dragging) {
      if (selectAxis(axis, index)) openMenu(axis, index, handle);
      return;
    }
    if (!current || current.boundary === null) return;
    let reason: string | null = null;
    run((tr, tablePos) => {
      const result = axis === 'column'
        ? moveTableColumn(tr, tablePos, current.from, current.boundary!)
        : moveTableRow(tr, tablePos, current.from, current.boundary!);
      if (!result.ok) {
        reason = result.reason;
        return false;
      }
      return setTableAxisSelection(tr, tablePos, axis, result.index);
    });
    if (reason === 'merged-cells') {
      notifications.show(editorMessage('editor.tableBlock.structure.mergedCellsBlockMove'), 'warning', 3000);
    } else if (reason === 'header-row') {
      notifications.show(editorMessage('editor.tableBlock.structure.headerRowFixed'), 'info', 2000);
    }
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
}

/* ---------- 菜单 ---------- */

const menuOptions = computed<CustomSelectOption<string>[]>(() => {
  const current = menu.value;
  const table = active.value;
  if (!current || !table) return [];
  if (current.axis === 'column') {
    const align = currentColumnAlignment(table.node, current.index);
    return [
      { isGroup: true, label: editorMessage('editor.tableBlock.structure.columnTitle', { index: current.index + 1 }) },
      { value: 'insert-before', text: editorMessage('editor.tableBlock.structure.insertColumnLeft') },
      { value: 'insert-after', text: editorMessage('editor.tableBlock.structure.insertColumnRight') },
      { isSeparator: true },
      {
        value: 'align',
        text: editorMessage('editor.tableBlock.structure.align'),
        children: [
          { value: 'align-left', text: editorMessage('editor.tableBlock.menu.alignLeft'), selected: align === 'left' },
          { value: 'align-center', text: editorMessage('editor.tableBlock.menu.alignCenter'), selected: align === 'center' },
          { value: 'align-right', text: editorMessage('editor.tableBlock.menu.alignRight'), selected: align === 'right' },
        ],
      },
      {
        value: 'fit-width',
        text: editorMessage('editor.tableBlock.structure.fitColumnWidth'),
        disabled: !tableColumnHasStoredWidth(table.node, current.index),
      },
      { value: 'ai-fill', text: editorMessage('editor.tableBlock.structure.aiFillColumn') },
      { isSeparator: true },
      { value: 'delete', text: editorMessage('editor.tableBlock.structure.deleteColumn'), variant: 'danger', disabled: columnCount.value <= 1 },
    ];
  }
  const header = current.index === 0 && tableHasHeaderRow(table.node);
  return [
    { isGroup: true, label: header ? editorMessage('editor.tableBlock.structure.headerRowTitle') : editorMessage('editor.tableBlock.structure.rowTitle', { index: current.index + 1 }) },
    {
      value: 'insert-before',
      text: editorMessage('editor.tableBlock.structure.insertRowAbove'),
      disabled: header,
      disabledReason: header ? editorMessage('editor.tableBlock.structure.noInsertAboveHeader') : undefined,
    },
    { value: 'insert-after', text: editorMessage('editor.tableBlock.structure.insertRowBelow') },
    ...(current.index === 0
      ? [{ value: 'toggle-header', text: header ? editorMessage('editor.tableBlock.structure.unsetHeaderRow') : editorMessage('editor.tableBlock.structure.setHeaderRow') }]
      : []),
    { isSeparator: true },
    { value: 'delete', text: editorMessage('editor.tableBlock.structure.deleteRow'), variant: 'danger', disabled: rowCount.value <= 1 },
  ];
});

function currentColumnAlignment(table: ProseMirrorNode, column: number): 'left' | 'center' | 'right' | null {
  const map = TableMap.get(table);
  const offset = map.map[(map.height > 1 ? 1 : 0) * map.width + column];
  const cell = offset === undefined ? null : table.nodeAt(offset);
  if (!cell) return null;
  const fromAttr: unknown = cell.attrs.align;
  const style: unknown = cell.attrs.style;
  const fromStyle = typeof style === 'string' ? /text-align:\s*(left|center|right)/.exec(style)?.[1] : undefined;
  const value = typeof fromAttr === 'string' && fromAttr ? fromAttr : fromStyle;
  return value === 'left' || value === 'center' || value === 'right' ? value : 'left';
}

function openMenu(axis: TableAxis, index: number, anchor: HTMLElement): void {
  menu.value = { axis, index, anchor };
  void nextTick(positionMenu);
}

function positionMenu(): void {
  const current = menu.value;
  if (!current) return;
  const rect = current.anchor.getBoundingClientRect();
  const size = menuWrapper.value ? measureFloatingLayoutSize(menuWrapper.value) : { width: 188, height: 260 };
  const width = size.width || 188;
  const height = size.height || 260;
  // 菜单从柄的边缘展开：列柄向下，行柄向右，间距 4px；贴不下时收回视口内。
  let left = current.axis === 'column' ? rect.left : rect.right + 4;
  let top = current.axis === 'column' ? rect.bottom + 4 : rect.top;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  if (top + height > window.innerHeight - 8) top = Math.max(8, (current.axis === 'column' ? rect.top - 4 : rect.bottom) - height);
  menuStyle.value = { position: 'fixed', top: `${top}px`, left: `${left}px` };
}

function closeMenu(): void {
  menu.value = null;
}

/**
 * 菜单不把柄当触发元素：否则关闭时焦点会还给柄，撤销与继续输入落不到正文。
 * 用户关闭（Escape、点外面）或选完动作后，下一帧把焦点交回编辑器。
 */
function returnFocusToEditor(): void {
  const editor = editorValue.value;
  onNextFrame(() => {
    if (editor && !editor.isDestroyed && !menu.value) editor.view.focus();
  });
}

function dismissMenu(): void {
  if (!menu.value) return;
  closeMenu();
  returnFocusToEditor();
}

const mergedEditorProps = computed(() => ({
  editor: editorValue.value,
  showToolbar: true,
  position: { top: 0, left: 0 },
  setCommandExecuting: () => {},
  requestHideToolbar: () => floatingToolbarService.close(),
}));
const { handleAIAction } = useTableAiInteraction({
  mergedEditorProps,
  hideToolbar: () => floatingToolbarService.close(),
});

function onMenuSelect(value: unknown): void {
  const current = menu.value;
  const editor = editorValue.value;
  const table = active.value;
  if (!current || !editor || !table || typeof value !== 'string') return;
  closeMenu();
  const before = current.index;
  const after = current.index + 1;
  switch (value) {
    case 'insert-before':
      insertAt(current.axis, before);
      break;
    case 'insert-after':
      insertAt(current.axis, after);
      break;
    case 'align-left':
    case 'align-center':
    case 'align-right':
      if (selectAxis('column', current.index)) {
        (value === 'align-left' ? alignCellLeft : value === 'align-center' ? alignCellCenter : alignCellRight)(editor);
      }
      break;
    case 'fit-width':
      run((tr, tablePos) => clearTableColumnWidth(tr, tablePos, current.index));
      break;
    case 'ai-fill':
      if (selectAxis('column', current.index)) void handleAIAction('aiFill');
      break;
    case 'toggle-header':
      run((tr, tablePos) => toggleTableHeaderRow(tr, tablePos));
      break;
    case 'delete':
      if (current.axis === 'column') deleteColumnByIndex(editor, table.pos, current.index);
      else if (selectAxis('row', current.index)) deleteRow(editor);
      break;
  }
  if (value !== 'ai-fill') returnFocusToEditor();
}

/* ---------- 保活与生命周期 ---------- */

useTableRenderVirtualizationKeepAlive({
  editor: editorValue,
  activePos: computed(() => (menu.value || drag.value) ? active.value?.pos ?? null : null),
  reason: 'table-structure-edit',
});

function onTransaction(): void {
  selectionVersion.value += 1;
  schedule();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && drag.value) drag.value = null;
}

let boundEditor: Editor | null = null;

function bind(editor: Editor | null): void {
  if (boundEditor && !boundEditor.isDestroyed) boundEditor.off('transaction', onTransaction);
  boundEditor = editor;
  if (editor) editor.on('transaction', onTransaction);
}

document.addEventListener('pointermove', onPointerMove, { passive: true });
document.addEventListener('scroll', onScroll, { passive: true, capture: true });
window.addEventListener('resize', schedule, { passive: true });
document.addEventListener('keydown', onKeyDown);

watch(editorValue, editor => {
  bind(editor ?? null);
  closeMenu();
  active.value = null;
}, { immediate: true });

watch(() => tableAiModeStore.isActive, isActive => {
  if (isActive) {
    closeMenu();
    drag.value = null;
    active.value = null;
  }
});

onBeforeUnmount(() => {
  bind(null);
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('scroll', onScroll, { capture: true });
  window.removeEventListener('resize', schedule);
  document.removeEventListener('keydown', onKeyDown);
});
</script>
