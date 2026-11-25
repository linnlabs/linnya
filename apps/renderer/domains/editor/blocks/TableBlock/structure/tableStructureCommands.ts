/**
 * 行列柄的结构命令：选中整行整列、在分界插入、末尾追加、移动行列、清除列宽、切换表头行。
 * 全部按逻辑行列（TableMap）工作，只改传入的事务，不读 DOM；调用方 dispatch 一次即一步撤销。
 */
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { insertTableColumnAt } from '../commands/tableColumnInsertion';
import { insertTableRowAt } from '../commands/tableRowInsertion';

export type TableAxis = 'column' | 'row';

export type TableMoveResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly reason: 'merged-cells' | 'header-row' | 'no-op' | 'invalid' };

interface TableRect {
  readonly map: TableMap;
  readonly table: ProseMirrorNode;
  readonly tableStart: number;
}

function readTable(doc: ProseMirrorNode, tablePos: number): TableRect | null {
  const table = doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return null;
  return { map: TableMap.get(table), table, tableStart: tablePos + 1 };
}

function cellAt(rect: TableRect, row: number, column: number): ProseMirrorNode | null {
  const offset = rect.map.map[row * rect.map.width + column];
  return offset === undefined ? null : rect.table.nodeAt(offset);
}

/** 表格是否声明了表头行：以第一行全部是 tableHeader 为准，与 withHeaderRow 合同一致。 */
export function tableHasHeaderRow(table: ProseMirrorNode): boolean {
  const first = table.firstChild;
  if (!first || first.childCount === 0) return false;
  let header = true;
  first.forEach(cell => {
    if (cell.type.name !== 'tableHeader') header = false;
  });
  return header;
}

/** 点击柄：选中整列或整行（CellSelection），浮动工具条与键盘删除都作用于这片选区。 */
export function setTableAxisSelection(tr: Transaction, tablePos: number, axis: TableAxis, index: number): boolean {
  const rect = readTable(tr.doc, tablePos);
  if (!rect) return false;
  const limit = axis === 'column' ? rect.map.width : rect.map.height;
  if (index < 0 || index >= limit) return false;
  const { map } = rect;
  const first = axis === 'column' ? map.map[index] : map.map[index * map.width];
  const last = axis === 'column'
    ? map.map[(map.height - 1) * map.width + index]
    : map.map[index * map.width + map.width - 1];
  if (first === undefined || last === undefined) return false;
  tr.setSelection(new CellSelection(tr.doc.resolve(rect.tableStart + first), tr.doc.resolve(rect.tableStart + last)));
  return true;
}

export function selectTableAxis(state: EditorState, tablePos: number, axis: TableAxis, index: number): Transaction | null {
  const tr = state.tr;
  return setTableAxisSelection(tr, tablePos, axis, index) ? tr : null;
}

/**
 * 新列沿用表格的列宽方式：整张表都没有存储列宽时，新列也不写列宽，继续按内容分列。
 * 列插入工具默认给新格 150px，这里把“全空”的列宽数组收回为 null。
 */
function dropDefaultWidths(tr: Transaction, tablePos: number, tableHadWidths: boolean): void {
  if (tableHadWidths) return;
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return;
  table.descendants((node, offset) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return true;
    if (node.attrs.colwidth !== null) {
      tr.setNodeMarkup(tablePos + 1 + offset, null, { ...node.attrs, colwidth: null });
    }
    return false;
  });
}

function tableHasStoredWidths(table: ProseMirrorNode): boolean {
  let found = false;
  table.descendants(node => {
    if (found) return false;
    const widths: unknown = node.attrs.colwidth;
    if (Array.isArray(widths) && widths.some(width => typeof width === 'number' && width > 0)) found = true;
    return node.type.name !== 'tableCell' && node.type.name !== 'tableHeader';
  });
  return found;
}

/** 在逻辑列分界 index（0..width）插入一列；index 等于列数即末尾追加。 */
export function insertTableColumnAtIndex(tr: Transaction, tablePos: number, index: number): boolean {
  const rect = readTable(tr.doc, tablePos);
  if (!rect || index < 0 || index > rect.map.width) return false;
  const hadWidths = tableHasStoredWidths(rect.table);
  const result = insertTableColumnAt({ tr, rect, col: index });
  if (!result) return false;
  dropDefaultWidths(tr, tablePos, hadWidths);
  return true;
}

/** 在逻辑行分界 index（0..height）插入一行；有表头行时不在表头之上插入。 */
export function insertTableRowAtIndex(tr: Transaction, tablePos: number, index: number): boolean {
  const rect = readTable(tr.doc, tablePos);
  if (!rect || index < 0 || index > rect.map.height) return false;
  if (index === 0 && tableHasHeaderRow(rect.table)) return false;
  return Boolean(insertTableRowAt({ tr, rect, row: index }));
}

/** 移动涉及的行列范围内，任何单元格跨行或跨列都不允许移动，避免把合并单元格拆散。 */
function rangeHasMergedCells(rect: TableRect, axis: TableAxis, from: number, to: number): boolean {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  for (let index = low; index <= high; index++) {
    const count = axis === 'column' ? rect.map.height : rect.map.width;
    for (let other = 0; other < count; other++) {
      const cell = axis === 'column' ? cellAt(rect, other, index) : cellAt(rect, index, other);
      if (!cell) return true;
      const span = axis === 'column' ? cell.attrs.colspan : cell.attrs.rowspan;
      const cross = axis === 'column' ? cell.attrs.rowspan : cell.attrs.colspan;
      if (span !== 1 || (axis === 'column' && cross !== 1)) return true;
    }
  }
  return false;
}

/**
 * 把第 from 列移到分界 boundary（0..width）处。范围内有合并单元格时拒绝并说明原因。
 * 返回移动后该列的新索引。
 */
export function moveTableColumn(tr: Transaction, tablePos: number, from: number, boundary: number): TableMoveResult {
  const rect = readTable(tr.doc, tablePos);
  if (!rect || from < 0 || from >= rect.map.width || boundary < 0 || boundary > rect.map.width) {
    return { ok: false, reason: 'invalid' };
  }
  const target = boundary > from ? boundary - 1 : boundary;
  if (target === from) return { ok: false, reason: 'no-op' };
  if (rangeHasMergedCells(rect, 'column', from, target)) return { ok: false, reason: 'merged-cells' };

  const rows: ProseMirrorNode[] = [];
  rect.table.forEach((row, _offset, rowIndex) => {
    // 范围内的格都是 1×1，可以按逻辑列直接取出；范围外的格保持原有相对顺序。
    const order = Array.from({ length: rect.map.width }, (_, column) => column);
    order.splice(target, 0, order.splice(from, 1)[0]!);
    const seen = new Set<number>();
    const cells: ProseMirrorNode[] = [];
    for (const column of order) {
      const offset = rect.map.map[rowIndex * rect.map.width + column];
      if (offset === undefined || seen.has(offset)) continue;
      seen.add(offset);
      // 只收本行起始的格；上方行跨下来的格不属于这一行的节点。
      const cell = rect.table.nodeAt(offset);
      if (!cell) continue;
      const position = rect.map.findCell(offset);
      if (position.top !== rowIndex) continue;
      cells.push(cell);
    }
    rows.push(row.copy(Fragment.from(cells)));
  });
  replaceTableRows(tr, tablePos, rect.table, rows);
  return { ok: true, index: target };
}

/** 只替换表格内部的行，表格节点本身不变：NodeView、虚拟化保活与 decoration 都跟随同一张表。 */
function replaceTableRows(tr: Transaction, tablePos: number, table: ProseMirrorNode, rows: readonly ProseMirrorNode[]): void {
  tr.replaceWith(tablePos + 1, tablePos + table.nodeSize - 1, Fragment.from(rows));
}

/** 把第 from 行移到分界 boundary（0..height）处；表头行固定在第一行。 */
export function moveTableRow(tr: Transaction, tablePos: number, from: number, boundary: number): TableMoveResult {
  const rect = readTable(tr.doc, tablePos);
  if (!rect || from < 0 || from >= rect.map.height || boundary < 0 || boundary > rect.map.height) {
    return { ok: false, reason: 'invalid' };
  }
  const target = boundary > from ? boundary - 1 : boundary;
  if (target === from) return { ok: false, reason: 'no-op' };
  if (tableHasHeaderRow(rect.table) && (from === 0 || target === 0)) return { ok: false, reason: 'header-row' };
  if (rangeHasMergedCells(rect, 'row', from, target)) return { ok: false, reason: 'merged-cells' };
  const rows: ProseMirrorNode[] = [];
  rect.table.forEach(row => rows.push(row));
  rows.splice(target, 0, rows.splice(from, 1)[0]!);
  replaceTableRows(tr, tablePos, rect.table, rows);
  return { ok: true, index: target };
}

/** 按内容适配列宽：清除这一列的存储宽度；跨列的格只清除对应的那一段。 */
export function clearTableColumnWidth(tr: Transaction, tablePos: number, column: number): boolean {
  const rect = readTable(tr.doc, tablePos);
  if (!rect || column < 0 || column >= rect.map.width) return false;
  const touched = new Set<number>();
  let changed = false;
  for (let row = 0; row < rect.map.height; row++) {
    const offset = rect.map.map[row * rect.map.width + column];
    if (offset === undefined || touched.has(offset)) continue;
    touched.add(offset);
    const cell = rect.table.nodeAt(offset);
    const widths: unknown = cell?.attrs.colwidth;
    if (!cell || !Array.isArray(widths)) continue;
    const start = rect.map.colCount(offset);
    const next = widths.map((width: unknown, index) => (start + index === column ? 0 : width));
    const colwidth = next.every(width => !width) ? null : next;
    tr.setNodeMarkup(rect.tableStart + offset, null, { ...cell.attrs, colwidth });
    changed = true;
  }
  return changed;
}

/** 列是否有存储宽度（“按内容适配列宽”只在有宽度时可用）。 */
export function tableColumnHasStoredWidth(table: ProseMirrorNode, column: number): boolean {
  const map = TableMap.get(table);
  for (let row = 0; row < map.height; row++) {
    const offset = map.map[row * map.width + column];
    if (offset === undefined) continue;
    const widths: unknown = table.nodeAt(offset)?.attrs.colwidth;
    const width: unknown = Array.isArray(widths) ? widths[column - map.colCount(offset)] : null;
    if (typeof width === 'number' && width > 0) return true;
  }
  return false;
}

/** 第一行在 tableHeader / tableCell 之间切换，并同步表格的 withHeaderRow。 */
export function toggleTableHeaderRow(tr: Transaction, tablePos: number): boolean {
  const rect = readTable(tr.doc, tablePos);
  const first = rect?.table.firstChild;
  if (!rect || !first) return false;
  const schema = rect.table.type.schema;
  const makeHeader = !tableHasHeaderRow(rect.table);
  const type = makeHeader ? schema.nodes.tableHeader : schema.nodes.tableCell;
  if (!type) return false;
  first.forEach((cell, offset) => {
    if (cell.type !== type) tr.setNodeMarkup(rect.tableStart + 1 + offset, type, cell.attrs);
  });
  if ('withHeaderRow' in rect.table.attrs) {
    tr.setNodeMarkup(tablePos, null, { ...rect.table.attrs, withHeaderRow: makeHeader });
  }
  return true;
}
