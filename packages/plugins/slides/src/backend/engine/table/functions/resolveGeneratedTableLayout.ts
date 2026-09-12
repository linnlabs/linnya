import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import { DEFAULT_TEXT_LINE_SPACING_MULTIPLE, type TableCell, type TextStyle } from '@plugin/slides/shared';
import { buildTableColumnWidths, estimateTableDensity } from '../../visual/presentationVisualDefaults';
import type {
  GeneratedTableCell, GeneratedTableLayout, GeneratedTableLayoutInput,
} from '../definitions/generatedTableLayout';

/**
 * 生成表格的固有尺寸与格线唯一 owner。Yoga、RenderModel、PPTX 消费同一规则。
 * 测量复用 portable 文本引擎；它是确定性估算，不冒充 Host 最终字形测量。
 */
export function resolveGeneratedTableLayout(input: GeneratedTableLayoutInput): GeneratedTableLayout {
  const cells = placeCells(input);
  const columnCount = cells.reduce((max, cell) => Math.max(max, cell.column + cell.colSpan), 1);
  const rowCount = cells.reduce((max, cell) => Math.max(max, cell.row + cell.rowSpan), 1);
  // 样式不依赖最终高度，否则 auto-height 会在测量与物化之间产生循环定义。
  const dense = estimateTableDensity(input.headers, input.rows) > 110 || rowCount >= 5;
  const fontSize = input.fontSize ?? (dense ? 9.5 : 11);
  const headerFontSize = fontSize + 0.5;
  const padding = dense ? 0.03 : 0.05;
  const naturalColumns = Array.from({ length: columnCount }, () => padding * 2);
  for (const placement of cells) {
    const style = resolveCellStyle(placement, fontSize, headerFontSize);
    const measured = measureCell(placement.cell.text, style, 1, padding, 'none');
    const required = measured.maxLineWidthInches + padding * 2;
    growSpan(naturalColumns, placement.column, placement.colSpan, required);
  }
  const width = input.width ?? sum(naturalColumns);
  const columns = buildTableColumnWidths(width, input.headers, input.rows)
    ?? Array.from({ length: columnCount }, () => width / columnCount);
  // 消除旧列宽三位小数舍入的累计误差，格线总宽严格等于表格盒宽。
  const columnTotal = sum(columns);
  if (columnTotal > 0) columns.forEach((value, index) => { columns[index] = value * width / columnTotal; });
  const naturalRows = Array.from({ length: rowCount }, () => padding * 2);
  for (const placement of cells) {
    const style = resolveCellStyle(placement, fontSize, headerFontSize);
    const cellWidth = sum(columns.slice(placement.column, placement.column + placement.colSpan));
    const required = measureCell(placement.cell.text, style, cellWidth, padding, 'word').totalHeightInches;
    growSpan(naturalRows, placement.row, placement.rowSpan, required);
  }
  if (input.headers?.length) naturalRows[0] = Math.max(naturalRows[0], dense ? 0.28 : 0.32);
  const naturalHeight = sum(naturalRows);
  const height = input.height ?? naturalHeight;
  // 显式尺寸由作者拥有。压缩时同比缩放全部行，禁止首行 0 高、正文越出盒子的局部下限。
  // 有富余空间时分给正文，短表头不应因为整个表格变高而占据半张表。
  const firstExpandableRow = input.headers?.length && rowCount > 1 ? 1 : 0;
  const extraPerRow = (height - naturalHeight) / (rowCount - firstExpandableRow);
  const rows = naturalRows.map((value, index) => height < naturalHeight
    ? value * height / naturalHeight
    : value + (index >= firstExpandableRow ? extraPerRow : 0));
  return { columns, rows, cells, width, height, fontSize, headerFontSize, padding };
}

function placeCells(input: GeneratedTableLayoutInput): GeneratedTableCell[] {
  const cells: GeneratedTableCell[] = [];
  const occupied: Set<number>[] = [];
  const sourceRows: TableCell[][] = input.headers?.length
    ? [input.headers.map(text => ({ text })), ...input.rows]
    : input.rows;
  for (const [row, sourceCells] of sourceRows.entries()) {
    let column = 0;
    for (const cell of sourceCells) {
      const colSpan = cell.colspan ?? 1;
      const rowSpan = cell.rowspan ?? 1;
      // 后续行跳过上方 rowspan 占据的列；不能只在每一行从 0 累加 colspan。
      while (Array.from({ length: colSpan }, (_, offset) => column + offset)
        .some(candidate => occupied[row]?.has(candidate))) column += 1;
      cells.push({ cell, row, column, rowSpan, colSpan, isHeader: Boolean(input.headers?.length) && row === 0 });
      for (let r = row; r < row + rowSpan; r += 1) {
        const rowOccupancy = occupied[r] ?? new Set<number>();
        occupied[r] = rowOccupancy;
        for (let c = column; c < column + colSpan; c += 1) rowOccupancy.add(c);
      }
      column += colSpan;
    }
  }
  return cells;
}

function resolveCellStyle(cell: GeneratedTableCell, fontSize: number, headerFontSize: number): TextStyle & { fontSize: number } {
  return {
    bold: cell.isHeader || undefined, ...cell.cell.style,
    fontSize: cell.cell.style?.fontSize ?? (cell.isHeader ? headerFontSize : fontSize),
  };
}

function measureCell(text: string, style: TextStyle & { fontSize: number }, width: number, padding: number, wrap: 'word' | 'none') {
  return defaultTextMeasureService.measure({
    paragraphs: [{ text }],
    style: {
      fontSizePt: style.fontSize,
      fontFamily: style.fontFamily,
      bold: style.bold,
      italic: style.italic,
      letterSpacingPt: style.letterSpacing,
      lineHeightMultiplier: style.lineSpacing?.kind === 'exactPt'
        ? style.lineSpacing.value / style.fontSize
        : style.lineSpacing?.value ?? DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
    },
    box: { widthInches: width, wrap, padding: { top: padding, right: padding, bottom: padding, left: padding } },
    sourceKind: 'generated',
  });
}

function growSpan(sizes: number[], start: number, span: number, required: number): void {
  const current = sum(sizes.slice(start, start + span));
  if (required <= current) return;
  const addition = (required - current) / span;
  for (let index = start; index < start + span; index += 1) sizes[index] += addition;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
