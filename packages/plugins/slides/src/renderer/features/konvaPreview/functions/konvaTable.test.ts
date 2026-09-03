import { describe, expect, it } from 'vitest';
import type { TableRenderNode } from '../../../types/render';
import { buildTableBorderSegments, buildTableCellLayouts } from './konvaTable';

const tableNode: TableRenderNode = {
  id: 'table-1',
  kind: 'table',
  box: { x: 0, y: 0, w: 6, h: 3, unit: 'in' },
  zIndex: 0,
  columns: [2, 2, 2],
  rows: [1, 1, 1],
  headerRows: 1,
  cells: [
    { row: 0, col: 0, paragraphs: [{ runs: [{ text: 'Layer' }] }] },
    { row: 0, col: 1, colSpan: 2, paragraphs: [{ runs: [{ text: 'Value pool' }] }] },
    { row: 1, col: 0, paragraphs: [{ runs: [{ text: 'Apps' }] }] },
    { row: 1, col: 1, paragraphs: [{ runs: [{ text: '$6.8B' }] }] },
    { row: 1, col: 2, paragraphs: [{ runs: [{ text: '+28%' }] }] },
  ],
};

describe('konvaTable', () => {
  it('computes merged-cell layouts in inches', () => {
    const layouts = buildTableCellLayouts(tableNode);
    const mergedHeader = layouts.find((layout) => layout.cell.col === 1 && layout.cell.row === 0);

    expect(mergedHeader).toMatchObject({
      x: 2,
      y: 0,
      width: 4,
      height: 1,
      colSpan: 2,
      rowSpan: 1,
      isHeader: true,
    });
  });

  it('returns no border segments when cells have no explicit borders (PPT default)', () => {
    const borderSegments = buildTableBorderSegments(tableNode);
    expect(borderSegments).toHaveLength(0);
  });

  it('deduplicates shared table borders when cells have explicit borders', () => {
    const nodeWithBorders: TableRenderNode = {
      ...tableNode,
      cells: tableNode.cells.map(cell => ({
        ...cell,
        borders: {
          top: { paint: { type: 'solid', color: '#CCCCCC' }, width: 1, dash: 'solid' as const },
          right: { paint: { type: 'solid', color: '#CCCCCC' }, width: 1, dash: 'solid' as const },
          bottom: { paint: { type: 'solid', color: '#CCCCCC' }, width: 1, dash: 'solid' as const },
          left: { paint: { type: 'solid', color: '#CCCCCC' }, width: 1, dash: 'solid' as const },
        },
      })),
    };
    const borderSegments = buildTableBorderSegments(nodeWithBorders);

    // 3x2 网格（5 cells，含一个 colSpan=2），应该去重后得到若干段
    expect(borderSegments.length).toBeGreaterThan(0);
    expect(borderSegments[0]).toMatchObject({
      stroke: { paint: { type: 'solid', color: '#CCCCCC' }, width: 1 },
    });
  });
});
