import { describe, expect, it } from 'vitest';
import type { TableRenderNode } from '../../../../../types/render';
import { buildCellBorderConfig, buildCellTextNode } from '../tableBuilder';
import { buildTableCellLayouts } from '../../konvaTable';

function makeTable(): TableRenderNode {
  return {
    id: 'table-1',
    kind: 'table',
    box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
    zIndex: 0,
    columns: [2],
    rows: [1],
    cells: [{
      row: 0,
      col: 0,
      paragraphs: [{ runs: [{ text: 'Cell', fontSize: 12 }] }],
    }],
  };
}

describe('tableBuilder shared text layout contract', () => {
  it('fails closed when backend table-cell layout is missing', () => {
    const table = makeTable();
    const layout = buildTableCellLayouts(table)[0]!;
    expect(() => buildCellTextNode(table, layout)).toThrow('missing shared text layout');
  });

  it('reuses the backend layout without renderer-side measurement', () => {
    const table = makeTable();
    const textLayout = {
      lines: [],
      contentHeightInches: 0,
      appliedFontScale: 1,
      appliedLineSpacingReduction: 0,
      advanceSource: 'pretext' as const,
      overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
    };
    table.cells[0]!.textLayout = textLayout;

    const node = buildCellTextNode(table, buildTableCellLayouts(table)[0]!);

    expect(node.layout).toBe(textLayout);
  });

  it('converts the canonical point border width to preview pixels', () => {
    expect(buildCellBorderConfig({
      points: [0, 0, 1, 0],
      stroke: { paint: { type: 'solid', color: '#94A3B8' }, width: 0.75 },
    })).toMatchObject({
      stroke: '#94A3B8',
      strokeWidth: 1,
    });
  });
});
