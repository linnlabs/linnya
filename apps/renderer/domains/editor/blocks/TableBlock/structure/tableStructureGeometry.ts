/**
 * 行列柄的几何与悬停判定。测量只读 DOM（视口坐标），判定是纯函数：
 * 指针停在哪一列、哪一行就只给那一列、那一行出柄；靠近两列（两行）分界时出插入点、柄让位；
 * 指针到最后一行、最后一列附近才出末尾加号。
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';

export interface TableBand {
  readonly start: number;
  readonly end: number;
}

export interface TableStructureGeometry {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** 逻辑列在视口中的左右边界。 */
  readonly columns: readonly TableBand[];
  /** 行在视口中的上下边界。 */
  readonly rows: readonly TableBand[];
  /** 横向滚动容器的可见范围；滚出可见范围的列不出柄。 */
  readonly visible: TableBand;
}

export interface TableStructureHover {
  readonly inside: boolean;
  readonly column: number | null;
  readonly row: number | null;
  /** 插入点所在分界：插入后新列（行）的索引，1..n-1。 */
  readonly insertColumnAt: number | null;
  readonly insertRowAt: number | null;
  readonly appendColumn: boolean;
  readonly appendRow: boolean;
}

export const EMPTY_TABLE_HOVER: TableStructureHover = Object.freeze({
  inside: false,
  column: null,
  row: null,
  insertColumnAt: null,
  insertRowAt: null,
  appendColumn: false,
  appendRow: false,
});

/** 表格外沿还算“在表格附近”的距离：左上留给柄与插入点，右下留给末尾加号。 */
export const TABLE_HOVER_OUTSET = Object.freeze({ before: 18, after: 24 });
const INSERT_BAND = Object.freeze({ outside: 14, inside: 8 });
const INSERT_TOLERANCE = Object.freeze({ column: 10, row: 8 });

function nearestEdge(edges: readonly number[], value: number, tolerance: number): number | null {
  let best: number | null = null;
  edges.forEach((edge, index) => {
    const distance = Math.abs(edge - value);
    if (distance <= tolerance && (best === null || distance < Math.abs(edges[best]! - value))) best = index;
  });
  return best;
}

function findBand(bands: readonly TableBand[], value: number): number | null {
  const index = bands.findIndex(band => value >= band.start && value < band.end);
  return index < 0 ? null : index;
}

/** 表格在横向滚动容器里实际可见的左右边：行柄、行插入点都贴着可见左沿，不画到容器外。 */
export function visibleTableEdges(geometry: TableStructureGeometry): { left: number; right: number } {
  return {
    left: Math.max(geometry.left, geometry.visible.start),
    right: Math.min(geometry.right, geometry.visible.end),
  };
}

export function isPointNearTable(geometry: TableStructureGeometry, x: number, y: number): boolean {
  const { left, right } = visibleTableEdges(geometry);
  return x >= left - TABLE_HOVER_OUTSET.before && x <= right + TABLE_HOVER_OUTSET.after
    && y >= geometry.top - TABLE_HOVER_OUTSET.before && y <= geometry.bottom + TABLE_HOVER_OUTSET.after;
}

export function resolveTableStructureHover(geometry: TableStructureGeometry, x: number, y: number): TableStructureHover {
  if (!isPointNearTable(geometry, x, y)) return EMPTY_TABLE_HOVER;
  const visibleX = x >= geometry.visible.start && x <= geometry.visible.end;
  const column = visibleX ? findBand(geometry.columns, x) : null;
  const row = findBand(geometry.rows, y);
  const columnEdges = geometry.columns.slice(0, -1).map(band => band.end);
  const rowEdges = geometry.rows.slice(0, -1).map(band => band.end);
  const inTopBand = y >= geometry.top - INSERT_BAND.outside && y <= geometry.top + INSERT_BAND.inside;
  const left = visibleTableEdges(geometry).left;
  const inLeftBand = x >= left - INSERT_BAND.outside && x <= left + INSERT_BAND.inside + 2;
  const columnEdge = inTopBand && visibleX ? nearestEdge(columnEdges, x, INSERT_TOLERANCE.column) : null;
  const rowEdge = inLeftBand ? nearestEdge(rowEdges, y, INSERT_TOLERANCE.row) : null;
  const lastColumn = geometry.columns.length - 1;
  const lastRow = geometry.rows.length - 1;
  return {
    inside: true,
    column: columnEdge === null ? column : null,
    row: rowEdge === null ? row : null,
    insertColumnAt: columnEdge === null ? null : columnEdge + 1,
    insertRowAt: rowEdge === null ? null : rowEdge + 1,
    appendColumn: column === lastColumn || x >= geometry.right,
    appendRow: row === lastRow || y >= geometry.bottom,
  };
}

/** 拖动柄时离指针最近的分界（0..n），落在原位两侧视为不动。 */
export function resolveDropBoundary(bands: readonly TableBand[], pointer: number, from: number): number | null {
  if (bands.length === 0) return null;
  const edges = [bands[0]!.start, ...bands.map(band => band.end)];
  let best = 0;
  edges.forEach((edge, index) => {
    if (Math.abs(edge - pointer) < Math.abs(edges[best]! - pointer)) best = index;
  });
  return best === from || best === from + 1 ? null : best;
}

export interface MeasureTableStructureInput {
  readonly table: ProseMirrorNode;
  readonly tableElement: HTMLTableElement;
  /** 由表格内偏移取单元格 DOM（编辑器里是 view.nodeDOM(tableStart + offset)）。 */
  readonly cellElementAt: (offset: number) => Element | null;
  readonly scroller: HTMLElement | null;
}

/**
 * 逻辑列边界取该列里不跨列的格；整列都被跨列格覆盖时按跨列格平均分。
 * 行边界取 DOM 行（tableRow 与 tr 一一对应）。
 */
export function measureTableStructure(input: MeasureTableStructureInput): TableStructureGeometry | null {
  const { table, tableElement, cellElementAt, scroller } = input;
  const map = TableMap.get(table);
  const box = tableElement.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const columns: TableBand[] = [];
  for (let column = 0; column < map.width; column++) {
    let band: TableBand | null = null;
    let fallback: TableBand | null = null;
    for (let row = 0; row < map.height && !band; row++) {
      const offset = map.map[row * map.width + column]!;
      const element = cellElementAt(offset);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const span = table.nodeAt(offset)?.attrs.colspan ?? 1;
      if (span === 1) {
        band = { start: rect.left, end: rect.right };
      } else if (!fallback) {
        const start = map.colCount(offset);
        const width = rect.width / span;
        fallback = { start: rect.left + width * (column - start), end: rect.left + width * (column - start + 1) };
      }
    }
    const resolved = band ?? fallback;
    if (!resolved) return null;
    columns.push(resolved);
  }
  const rows = Array.from(tableElement.rows).map(row => {
    const rect = row.getBoundingClientRect();
    return { start: rect.top, end: rect.bottom };
  });
  if (rows.length !== map.height) return null;
  const visibleRect = scroller?.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    columns,
    rows,
    visible: visibleRect ? { start: visibleRect.left, end: visibleRect.right } : { start: box.left, end: box.right },
  };
}
