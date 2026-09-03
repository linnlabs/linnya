import type { RenderTableCell, TableRenderNode } from './renderModel';

export interface TableCellLayout {
  cell: RenderTableCell;
  x: number;
  y: number;
  width: number;
  height: number;
  rowSpan: number;
  colSpan: number;
  isHeader: boolean;
}

/** 表格合并单元格几何的唯一实现，后端文本布局与 renderer 共用。 */
export function resolveTableCellLayouts(node: TableRenderNode): TableCellLayout[] {
  const columnOffsets = accumulateOffsets(node.columns);
  const rowOffsets = accumulateOffsets(node.rows);

  return node.cells.map((cell) => {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    return {
      cell,
      x: columnOffsets[cell.col] ?? 0,
      y: rowOffsets[cell.row] ?? 0,
      width: sumSlice(node.columns, cell.col, colSpan),
      height: sumSlice(node.rows, cell.row, rowSpan),
      rowSpan,
      colSpan,
      isHeader: cell.row < (node.headerRows ?? 0),
    };
  });
}

function accumulateOffsets(sizes: readonly number[]): number[] {
  const offsets = [0];
  for (const size of sizes) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + size);
  }
  return offsets;
}

function sumSlice(sizes: readonly number[], start: number, span: number): number {
  return sizes.slice(start, start + span).reduce((sum, size) => sum + size, 0);
}
