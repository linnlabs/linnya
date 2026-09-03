import { TableMap } from '@tiptap/pm/tables';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { getCellOffsetAtLogicalPosition } from '../../position/tableMapUtils';

export interface RectMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointMetrics {
  left: number;
  top: number;
}

export interface RectDeltaMetrics {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface TableCoordinateHeaderEditor {
  view: {
    state: EditorState;
    dom: HTMLElement;
    nodeDOM(pos: number): Node | null;
  };
}

export interface TablePositionMetrics {
  tableRect: RectMetrics;
  containerRect: PointMetrics;
  tableScrollContainerRect: PointMetrics | null;
  tableTopInContainer: number;
  tableVisibleWidth: number | null;
  editorShellScrollbarHeight: number;
  editorShellBottomInViewport: number;
  delta: RectDeltaMetrics;
}

export interface TableSizeMeasurementOptions {
  editor: TableCoordinateHeaderEditor;
  tablePos: number;
  getCellRect: (editor: TableCoordinateHeaderEditor, cellDocPos: number) => RectMetrics | null;
  forceDomMeasurement?: boolean;
  debug?: (message: string, payload?: unknown) => void;
}

export type PageScrollContainer = HTMLElement | Window;

const DEFAULT_COLUMN_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 30;

interface LogicalCellMeasurementTarget {
  cellOffset: number;
  cellDocPos: number;
  cellNode: ProseMirrorNode;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

function toRectMetrics(rect: DOMRect | ClientRect): RectMetrics {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function calculateDelta(rect: RectMetrics, previousRect: RectMetrics | null): RectDeltaMetrics {
  if (!previousRect) {
    return { dx: 0, dy: 0, dw: 0, dh: 0 };
  }

  return {
    dx: Number((rect.left - previousRect.left).toFixed(2)),
    dy: Number((rect.top - previousRect.top).toFixed(2)),
    dw: Number((rect.width - previousRect.width).toFixed(2)),
    dh: Number((rect.height - previousRect.height).toFixed(2)),
  };
}

function getPositiveColwidth(colwidth: unknown): number | null {
  const width = Array.isArray(colwidth) ? colwidth[0] : colwidth;
  return typeof width === 'number' && width > 0 ? width : null;
}

function getPositiveColwidthAtLogicalColumn(
  cellNode: ProseMirrorNode,
  spanIndex: number
): number | null {
  const colwidth = cellNode.attrs?.colwidth;
  if (Array.isArray(colwidth)) {
    const width = colwidth[spanIndex];
    return typeof width === 'number' && width > 0 ? width : null;
  }

  return spanIndex === 0 ? getPositiveColwidth(colwidth) : null;
}

function resolveLogicalCellMeasurementTarget(params: {
  tableNode: ProseMirrorNode;
  tablePos: number;
  map: TableMap;
  row: number;
  col: number;
}): LogicalCellMeasurementTarget | null {
  const cellOffset = getCellOffsetAtLogicalPosition(params.map, params.row, params.col);
  if (cellOffset === null) return null;

  const cellNode = params.tableNode.nodeAt(cellOffset);
  if (!cellNode) return null;

  try {
    const rect = params.map.findCell(cellOffset);
    return {
      cellOffset,
      cellDocPos: params.tablePos + 1 + cellOffset,
      cellNode,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    };
  } catch {
    return null;
  }
}

function collectColumnTargets(params: {
  tableNode: ProseMirrorNode;
  tablePos: number;
  map: TableMap;
  col: number;
}): LogicalCellMeasurementTarget[] {
  const targets: LogicalCellMeasurementTarget[] = [];
  const seenOffsets = new Set<number>();

  for (let row = 0; row < params.map.height; row += 1) {
    const target = resolveLogicalCellMeasurementTarget({ ...params, row });
    if (!target || seenOffsets.has(target.cellOffset)) continue;
    seenOffsets.add(target.cellOffset);
    targets.push(target);
  }

  return targets;
}

function collectRowTargets(params: {
  tableNode: ProseMirrorNode;
  tablePos: number;
  map: TableMap;
  row: number;
}): LogicalCellMeasurementTarget[] {
  const targets: LogicalCellMeasurementTarget[] = [];
  const seenOffsets = new Set<number>();

  for (let col = 0; col < params.map.width; col += 1) {
    const target = resolveLogicalCellMeasurementTarget({ ...params, col });
    if (!target || seenOffsets.has(target.cellOffset)) continue;
    seenOffsets.add(target.cellOffset);
    targets.push(target);
  }

  return targets;
}

function resolveColumnWidthFromDocument(
  targets: LogicalCellMeasurementTarget[],
  col: number
): number | null {
  for (const target of targets) {
    const spanIndex = col - target.left;
    const width = getPositiveColwidthAtLogicalColumn(target.cellNode, spanIndex);
    if (width !== null) return width;
  }

  return null;
}

function resolveColumnWidthFromDom(
  options: TableSizeMeasurementOptions,
  targets: LogicalCellMeasurementTarget[]
): number | null {
  let spannedFallback: number | null = null;

  for (const target of targets) {
    const cellRect = options.getCellRect(options.editor, target.cellDocPos);
    if (!cellRect) continue;

    const colspan = Math.max(1, target.right - target.left);
    if (colspan === 1) return cellRect.width;
    if (spannedFallback === null) {
      spannedFallback = cellRect.width / colspan;
    }
  }

  return spannedFallback;
}

function resolveRowHeightFromDom(
  options: TableSizeMeasurementOptions,
  targets: LogicalCellMeasurementTarget[]
): number | null {
  let spannedFallback: number | null = null;

  for (const target of targets) {
    const cellRect = options.getCellRect(options.editor, target.cellDocPos);
    if (!cellRect) continue;

    const rowspan = Math.max(1, target.bottom - target.top);
    if (rowspan === 1) return cellRect.height;
    if (spannedFallback === null) {
      spannedFallback = cellRect.height / rowspan;
    }
  }

  return spannedFallback;
}

export function getTableDomElement(
  editor: TableCoordinateHeaderEditor | null | undefined,
  tablePos: number
): HTMLElement | null {
  if (!editor || !editor.view.dom.isConnected) return null;

  try {
    const tableDom = editor.view.nodeDOM(tablePos);
    return isHTMLElement(tableDom) ? tableDom : null;
  } catch {
    // 虚拟化 placeholder / editor 重建期间 nodeDOM 可能短暂不可用。
    return null;
  }
}

export function getTableNodeAtPosition(
  editor: TableCoordinateHeaderEditor,
  tablePos: number
): ProseMirrorNode | null {
  const tableNode = editor.view.state.doc.nodeAt(tablePos);
  return tableNode?.type.name === 'table' ? tableNode : null;
}

export function findEditorPageScrollContainer(
  editor: TableCoordinateHeaderEditor | null | undefined
): PageScrollContainer | null {
  if (!editor) return null;

  const editorShell = editor.view.dom.closest('.editor-shell');
  return isHTMLElement(editorShell) ? editorShell : window;
}

export function findTableHorizontalScrollContainer(
  editor: TableCoordinateHeaderEditor | null | undefined,
  tablePos: number,
  debug?: (message: string, payload?: unknown) => void
): HTMLElement | null {
  const tableDom = getTableDomElement(editor, tablePos);
  if (!tableDom) return null;

  const rootBlock = tableDom.closest('.root-block');
  if (!rootBlock) {
    debug?.('findTableScrollContainer: .root-block not found');
    return null;
  }

  const contentBlock = rootBlock.querySelector('.content');
  if (!isHTMLElement(contentBlock)) {
    debug?.('findTableScrollContainer: .content not found');
    return null;
  }

  debug?.('findTableScrollContainer: found', {
    scrollWidth: contentBlock.scrollWidth,
    clientWidth: contentBlock.clientWidth,
    hasScroll: contentBlock.scrollWidth > contentBlock.clientWidth,
  });

  return contentBlock;
}

export function measureTablePositionMetrics(params: {
  tableDom: HTMLElement;
  pageScrollContainer: PageScrollContainer | null;
  tableScrollContainer: HTMLElement | null;
  previousRect: RectMetrics | null;
}): TablePositionMetrics {
  const rect = toRectMetrics(params.tableDom.getBoundingClientRect());
  const delta = calculateDelta(rect, params.previousRect);

  let containerRect: PointMetrics = { left: 0, top: 0 };
  let tableTopInContainer = rect.top;
  let editorShellScrollbarHeight = 0;
  let editorShellBottomInViewport = 0;

  if (isHTMLElement(params.pageScrollContainer)) {
    const pageRect = params.pageScrollContainer.getBoundingClientRect();
    containerRect = { left: pageRect.left, top: pageRect.top };
    tableTopInContainer = rect.top - pageRect.top;
    editorShellScrollbarHeight =
      params.pageScrollContainer.offsetHeight - params.pageScrollContainer.clientHeight;
    editorShellBottomInViewport = pageRect.bottom - editorShellScrollbarHeight;
  }

  let tableVisibleWidth: number | null = null;
  let tableScrollContainerRect: PointMetrics | null = null;

  if (params.tableScrollContainer) {
    tableVisibleWidth = params.tableScrollContainer.clientWidth;
    const tableScrollerRect = params.tableScrollContainer.getBoundingClientRect();
    tableScrollContainerRect = {
      left: tableScrollerRect.left,
      top: tableScrollerRect.top,
    };
  }

  return {
    tableRect: rect,
    containerRect,
    tableScrollContainerRect,
    tableTopInContainer,
    tableVisibleWidth,
    editorShellScrollbarHeight,
    editorShellBottomInViewport,
    delta,
  };
}

export function measureTableColumnWidths(options: TableSizeMeasurementOptions): number[] | null {
  const tableNode = getTableNodeAtPosition(options.editor, options.tablePos);
  if (!tableNode) {
    options.debug?.('measureColumnWidths skipped: table node not found or invalid at pos', {
      tablePos: options.tablePos,
    });
    return null;
  }

  const map = TableMap.get(tableNode);
  const widths: number[] = [];

  for (let col = 0; col < map.width; col += 1) {
    try {
      const targets = collectColumnTargets({
        tableNode,
        tablePos: options.tablePos,
        map,
        col,
      });
      const colwidth = resolveColumnWidthFromDocument(targets, col);

      if (colwidth !== null && options.forceDomMeasurement !== true) {
        widths.push(colwidth);
        options.debug?.(`Column ${col} width from doc colwidth: ${colwidth}px`);
        continue;
      }

      const domWidth = resolveColumnWidthFromDom(options, targets);
      if (domWidth !== null) {
        widths.push(domWidth);
        options.debug?.(`Column ${col} width from DOM: ${domWidth}px`);
      } else {
        options.debug?.(`Column ${col} using default width`);
        widths.push(DEFAULT_COLUMN_WIDTH);
      }
    } catch (error) {
      console.warn(`[TableCoordinateHeaders] Failed to measure column ${col}:`, error);
      widths.push(DEFAULT_COLUMN_WIDTH);
    }
  }

  return widths;
}

export function measureTableRowHeights(options: TableSizeMeasurementOptions): number[] | null {
  const tableNode = getTableNodeAtPosition(options.editor, options.tablePos);
  if (!tableNode) {
    options.debug?.('measureRowHeights skipped: table node not found or invalid at pos', {
      tablePos: options.tablePos,
    });
    return null;
  }

  const map = TableMap.get(tableNode);
  const heights: number[] = [];

  for (let row = 0; row < map.height; row += 1) {
    try {
      const targets = collectRowTargets({
        tableNode,
        tablePos: options.tablePos,
        map,
        row,
      });
      const domHeight = resolveRowHeightFromDom(options, targets);

      if (domHeight !== null) {
        heights.push(domHeight);
      } else {
        console.warn(`[TableCoordinateHeaders] Failed to measure row ${row}, using default height`);
        heights.push(DEFAULT_ROW_HEIGHT);
      }
    } catch (error) {
      console.warn(`[TableCoordinateHeaders] Failed to measure row ${row}:`, error);
      heights.push(DEFAULT_ROW_HEIGHT);
    }
  }

  return heights;
}
