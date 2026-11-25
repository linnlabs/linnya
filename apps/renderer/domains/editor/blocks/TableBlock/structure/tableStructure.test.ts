import { describe, expect, it } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import {
  clearTableColumnWidth,
  insertTableColumnAtIndex,
  insertTableRowAtIndex,
  moveTableColumn,
  moveTableRow,
  selectTableAxis,
  tableColumnHasStoredWidth,
  tableHasHeaderRow,
  toggleTableHeaderRow,
} from './tableStructureCommands';
import {
  EMPTY_TABLE_HOVER,
  resolveDropBoundary,
  resolveTableStructureHover,
  type TableStructureGeometry,
} from './tableStructureGeometry';

const cellAttrs = { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, align: { default: null }, style: { default: null } };
const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: { content: 'table', attrs: { id: { default: null } } },
    table: { content: 'tableRow+', tableRole: 'table', attrs: { id: { default: '' }, withHeaderRow: { default: true } } },
    tableRow: { content: '(tableCell | tableHeader)+', tableRole: 'row' },
    tableCell: { content: 'tableCellContentBlock+', tableRole: 'cell', attrs: cellAttrs },
    tableHeader: { content: 'tableCellContentBlock+', tableRole: 'header_cell', attrs: cellAttrs },
    tableCellContentBlock: { content: 'text*', attrs: { id: { default: null }, blockType: { default: 'tableCellContent' } } },
  },
});

type CellSpec = string | { text: string; colspan?: number; rowspan?: number; colwidth?: number[] | null };

function cell(type: 'tableCell' | 'tableHeader', spec: CellSpec) {
  const value = typeof spec === 'string' ? { text: spec } : spec;
  return schema.nodes[type]!.create(
    { colspan: value.colspan ?? 1, rowspan: value.rowspan ?? 1, colwidth: value.colwidth ?? null },
    schema.nodes.tableCellContentBlock!.create({ id: `c-${value.text}` }, value.text ? schema.text(value.text) : undefined),
  );
}

function createState(rows: CellSpec[][], header = true) {
  const table = schema.nodes.table!.create({ withHeaderRow: header }, rows.map((row, index) =>
    schema.nodes.tableRow!.create(null, row.map(spec => cell(header && index === 0 ? 'tableHeader' : 'tableCell', spec)))));
  return EditorState.create({ doc: schema.nodes.doc!.create(null, schema.nodes.rootBlock!.create({ id: 'r' }, table)) });
}

const TABLE_POS = 1;
const tableOf = (state: EditorState) => state.doc.nodeAt(TABLE_POS)!;
function texts(table: ProseMirrorNode): string[][] {
  const rows: string[][] = [];
  table.forEach(row => {
    const cells: string[] = [];
    row.forEach(item => cells.push(item.textContent));
    rows.push(cells);
  });
  return rows;
}
function apply(state: EditorState, build: (tr: EditorState['tr']) => unknown) {
  const tr = state.tr;
  build(tr);
  return state.apply(tr);
}

const base = () => createState([['名称', '状态', '负责人'], ['桌面端', '进行中', '王一'], ['云服务', '完成', '李二']]);

describe('行列柄结构命令', () => {
  it('选中整列与整行（CellSelection）', () => {
    const state = base();
    const column = state.apply(selectTableAxis(state, TABLE_POS, 'column', 1)!);
    expect(column.selection).toBeInstanceOf(CellSelection);
    expect((column.selection as CellSelection).isColSelection()).toBe(true);
    const row = state.apply(selectTableAxis(state, TABLE_POS, 'row', 2)!);
    expect((row.selection as CellSelection).isRowSelection()).toBe(true);
    expect(selectTableAxis(state, TABLE_POS, 'column', 3)).toBeNull();
  });

  it('在分界插入列与行；末尾追加；表头之上不插入', () => {
    let state = apply(base(), tr => insertTableColumnAtIndex(tr, TABLE_POS, 1));
    expect(texts(tableOf(state))[0]).toEqual(['名称', '', '状态', '负责人']);
    state = apply(state, tr => insertTableColumnAtIndex(tr, TABLE_POS, 4));
    expect(texts(tableOf(state))[1]).toEqual(['桌面端', '', '进行中', '王一', '']);
    state = apply(state, tr => insertTableRowAtIndex(tr, TABLE_POS, 3));
    expect(texts(tableOf(state))).toHaveLength(4);
    const tr = state.tr;
    expect(insertTableRowAtIndex(tr, TABLE_POS, 0)).toBe(false);
  });

  it('表格没有存储列宽时，新列也不写列宽', () => {
    const state = apply(base(), tr => insertTableColumnAtIndex(tr, TABLE_POS, 1));
    let widths = 0;
    tableOf(state).descendants(node => {
      if (node.attrs.colwidth !== undefined && node.attrs.colwidth !== null) widths += 1;
      return true;
    });
    expect(widths).toBe(0);
  });

  it('移动列：内容随列移动，表格节点不变', () => {
    const state = base();
    const tr = state.tr;
    const result = moveTableColumn(tr, TABLE_POS, 0, 3);
    expect(result).toEqual({ ok: true, index: 2 });
    const next = state.apply(tr);
    expect(texts(tableOf(next))).toEqual([['状态', '负责人', '名称'], ['进行中', '王一', '桌面端'], ['完成', '李二', '云服务']]);
    expect(tableOf(next).attrs.withHeaderRow).toBe(true);
  });

  it('移动行；表头行固定在第一行；落在原位视为不动', () => {
    const state = base();
    const tr = state.tr;
    expect(moveTableRow(tr, TABLE_POS, 2, 1)).toEqual({ ok: true, index: 1 });
    expect(texts(tableOf(state.apply(tr))).map(row => row[0])).toEqual(['名称', '云服务', '桌面端']);
    expect(moveTableRow(state.tr, TABLE_POS, 0, 2)).toEqual({ ok: false, reason: 'header-row' });
    expect(moveTableRow(state.tr, TABLE_POS, 2, 0)).toEqual({ ok: false, reason: 'header-row' });
    expect(moveTableRow(state.tr, TABLE_POS, 1, 2)).toEqual({ ok: false, reason: 'no-op' });
  });

  it('移动范围内有合并单元格时拒绝；范围外的合并不影响', () => {
    const merged = createState([
      ['甲', '乙', '丙', '丁'],
      [{ text: '跨两列', colspan: 2 }, '丙2', '丁2'],
      ['甲3', '乙3', '丙3', '丁3'],
    ]);
    expect(moveTableColumn(merged.tr, TABLE_POS, 0, 3)).toEqual({ ok: false, reason: 'merged-cells' });
    const tr = merged.tr;
    expect(moveTableColumn(tr, TABLE_POS, 3, 2)).toEqual({ ok: true, index: 2 });
    expect(texts(tableOf(merged.apply(tr)))).toEqual([['甲', '乙', '丁', '丙'], ['跨两列', '丁2', '丙2'], ['甲3', '乙3', '丁3', '丙3']]);
    const tall = createState([['甲', '乙'], [{ text: '跨两行', rowspan: 2 }, '乙2'], ['乙3'], ['甲4', '乙4']]);
    expect(moveTableRow(tall.tr, TABLE_POS, 3, 1)).toEqual({ ok: false, reason: 'merged-cells' });
  });

  it('按内容适配列宽只清除这一列', () => {
    const state = createState([[{ text: 'a', colwidth: [120] }, { text: 'b', colwidth: [80] }], [{ text: 'c', colwidth: [120] }, { text: 'd', colwidth: [80] }]]);
    expect(tableColumnHasStoredWidth(tableOf(state), 0)).toBe(true);
    const next = apply(state, tr => clearTableColumnWidth(tr, TABLE_POS, 0));
    expect(tableColumnHasStoredWidth(tableOf(next), 0)).toBe(false);
    expect(tableColumnHasStoredWidth(tableOf(next), 1)).toBe(true);
  });

  it('切换表头行同步 withHeaderRow', () => {
    let state = base();
    expect(tableHasHeaderRow(tableOf(state))).toBe(true);
    state = apply(state, tr => toggleTableHeaderRow(tr, TABLE_POS));
    expect(tableHasHeaderRow(tableOf(state))).toBe(false);
    expect(tableOf(state).attrs.withHeaderRow).toBe(false);
    state = apply(state, tr => toggleTableHeaderRow(tr, TABLE_POS));
    expect(tableHasHeaderRow(tableOf(state))).toBe(true);
    expect(tableOf(state).attrs.withHeaderRow).toBe(true);
  });
});

describe('行列柄悬停判定', () => {
  // 三列（100/100/200）、三行（各 30），表格左上角在 (100, 100)。
  const geometry: TableStructureGeometry = {
    left: 100, top: 100, right: 500, bottom: 190,
    columns: [{ start: 100, end: 200 }, { start: 200, end: 300 }, { start: 300, end: 500 }],
    rows: [{ start: 100, end: 130 }, { start: 130, end: 160 }, { start: 160, end: 190 }],
    visible: { start: 100, end: 500 },
  };

  it('格子中间：只出这一列、这一行的柄', () => {
    expect(resolveTableStructureHover(geometry, 250, 145)).toMatchObject({ column: 1, row: 1, insertColumnAt: null, insertRowAt: null, appendColumn: false, appendRow: false });
  });

  it('上边框附近靠近分界：出插入点，列柄让位', () => {
    expect(resolveTableStructureHover(geometry, 203, 96)).toMatchObject({ column: null, insertColumnAt: 1 });
  });

  it('左边框附近靠近行分界：出行插入点', () => {
    expect(resolveTableStructureHover(geometry, 96, 161)).toMatchObject({ row: null, insertRowAt: 2 });
  });

  it('最后一行、最后一列附近才出末尾加号', () => {
    expect(resolveTableStructureHover(geometry, 450, 175)).toMatchObject({ appendColumn: true, appendRow: true });
    expect(resolveTableStructureHover(geometry, 510, 145)).toMatchObject({ appendColumn: true, appendRow: false });
  });

  it('离开表格附近：什么都不出', () => {
    expect(resolveTableStructureHover(geometry, 700, 145)).toBe(EMPTY_TABLE_HOVER);
  });

  it('滚出可见范围的列不出柄', () => {
    expect(resolveTableStructureHover({ ...geometry, visible: { start: 100, end: 280 } }, 400, 145).column).toBeNull();
  });

  it('横向滚动后，行插入点与“附近”判定都以可见左沿为准', () => {
    const scrolled = { ...geometry, left: 20, right: 420, columns: geometry.columns.map(band => ({ start: band.start - 80, end: band.end - 80 })), visible: { start: 100, end: 420 } };
    expect(resolveTableStructureHover(scrolled, 96, 161)).toMatchObject({ insertRowAt: 2 });
    expect(resolveTableStructureHover(scrolled, 40, 145)).toBe(EMPTY_TABLE_HOVER);
  });

  it('拖动落点取最近分界，原位两侧视为不动', () => {
    expect(resolveDropBoundary(geometry.columns, 480, 0)).toBe(3);
    expect(resolveDropBoundary(geometry.columns, 190, 0)).toBeNull();
    expect(resolveDropBoundary(geometry.columns, 110, 2)).toBe(0);
  });
});
