// @vitest-environment jsdom

import { Fragment, Schema, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { normalizePastedTableSlice, sanitizePastedTableHtml } from './TablePasteSanitizerHandler';

const schema = new Schema({
  nodes: {
    doc: { content: 'table' },
    text: { group: 'inline' },
    hardBreak: {
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }],
    },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    table: {
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: '(tableCell | tableHeader)+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'block*',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
        style: { default: null },
      },
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
    tableHeader: {
      content: 'block*',
      tableRole: 'header_cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
        style: { default: null },
      },
      toDOM: () => ['th', 0],
      parseDOM: [{ tag: 'th' }],
    },
    tableCellContentBlock: {
      group: 'block',
      content: 'inline*',
      attrs: {
        id: { default: null },
        blockType: { default: 'tableCellContent' },
      },
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
  },
});

function paragraph(text: string): PMNode {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function contentBlock(id: string | null, text: string, attrs: Record<string, string | null> = {}): PMNode {
  return schema.nodes.tableCellContentBlock.create(
    { id, blockType: 'tableCellContent', ...attrs },
    text ? schema.text(text) : null
  );
}

function tableCell(children: PMNode[], style = 'border: 1px solid red'): PMNode {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, style },
    children
  );
}

function tableHeader(children: PMNode[], style = 'background: yellow'): PMNode {
  return schema.nodes.tableHeader.create(
    { colspan: 1, rowspan: 1, colwidth: null, style },
    children
  );
}

function tableSlice(rows: PMNode[][]): Slice {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row));
  const table = schema.nodes.table.create(null, tableRows);
  return new Slice(Fragment.from(table), 0, 0);
}

function firstTable(slice: Slice): PMNode {
  const table = slice.content.firstChild;
  if (!table || table.type.name !== 'table') {
    throw new Error('测试 Slice 缺少 table');
  }
  return table;
}

function readCells(slice: Slice) {
  const rows: Array<Array<{
    childCount: number;
    style: string | null;
    firstType: string | null;
    firstId: string | null;
    firstBlockType: string | null;
    text: string;
  }>> = [];

  firstTable(slice).forEach((rowNode) => {
    const row: Array<{
      childCount: number;
      style: string | null;
      firstType: string | null;
      firstId: string | null;
      firstBlockType: string | null;
      text: string;
    }> = [];

    rowNode.forEach((cellNode) => {
      row.push({
        childCount: cellNode.childCount,
        style: cellNode.attrs.style,
        firstType: cellNode.firstChild?.type.name ?? null,
        firstId: cellNode.firstChild?.attrs.id ?? null,
        firstBlockType: cellNode.firstChild?.attrs.blockType ?? null,
        text: cellNode.textContent,
      });
    });
    rows.push(row);
  });

  return rows;
}

function expectGeneratedId(value: string | null): void {
  expect(typeof value).toBe('string');
  expect(value?.length).toBeGreaterThan(0);
}

describe('TablePasteSanitizerHandler', () => {
  it('normalizes pasted table cell content through the shared cell invariant', () => {
    const slice = tableSlice([
      [
        tableCell([paragraph('Legacy'), paragraph('Cell')]),
        tableCell([contentBlock('a1', 'Alpha'), contentBlock('a2', 'Beta')]),
      ],
      [
        tableCell([]),
        tableHeader([contentBlock(null, 'Header', { blockType: null })]),
      ],
    ]);

    const normalized = normalizePastedTableSlice(slice, schema);
    const cells = readCells(normalized);

    expect(cells[0][0]).toMatchObject({
      childCount: 1,
      style: null,
      firstType: 'tableCellContentBlock',
      firstBlockType: 'tableCellContent',
      text: 'Legacy Cell',
    });
    expectGeneratedId(cells[0][0].firstId);

    expect(cells[0][1]).toMatchObject({
      childCount: 1,
      style: null,
      firstType: 'tableCellContentBlock',
      firstBlockType: 'tableCellContent',
      text: 'Alpha Beta',
    });
    expectGeneratedId(cells[0][1].firstId);

    expect(cells[1][0]).toMatchObject({
      childCount: 1,
      style: null,
      firstType: 'tableCellContentBlock',
      firstBlockType: 'tableCellContent',
      text: '',
    });
    expectGeneratedId(cells[1][0].firstId);

    expect(cells[1][1]).toMatchObject({
      childCount: 1,
      style: null,
      firstType: 'tableCellContentBlock',
      firstBlockType: 'tableCellContent',
      text: 'Header',
    });
    expectGeneratedId(cells[1][1].firstId);
  });

  it('keeps non-table slices untouched', () => {
    const paragraphSlice = new Slice(Fragment.from(paragraph('Only text')), 0, 0);

    expect(normalizePastedTableSlice(paragraphSlice, schema)).toBe(paragraphSlice);
  });

  it('removes style pollution before table HTML is parsed', () => {
    const html = `
      <style>td { border: 1px solid red; }</style>
      <table border="1" width="100">
        <tr>
          <td style="font-family: serif; color: red"><font color="red">A</font><p>&nbsp;</p></td>
        </tr>
      </table>
    `;

    const sanitized = sanitizePastedTableHtml(html);

    expect(sanitized).toContain('<table>');
    expect(sanitized).toContain('A');
    expect(sanitized).not.toContain('<style');
    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('<font');
    expect(sanitized).not.toContain('border=');
    expect(sanitized).not.toContain('width=');
    expect(sanitized).not.toContain('&nbsp;');
  });
});
