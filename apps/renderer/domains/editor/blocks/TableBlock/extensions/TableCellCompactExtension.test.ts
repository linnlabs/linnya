import { describe, expect, it } from 'vitest';
import { EditorState, type Plugin } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { workspaceMarkdownSchemaLite as schema } from '@linnya/markdown-document-core/workspace-schema';
import { TableCellCompactExtension, tableCellCompactPluginKey } from './TableCellCompactExtension';

const text = (value: string) => ({ type: 'text', text: value });
const cell = (type: 'tableCell' | 'tableHeader', value: string) => ({
  type,
  content: [{ type: 'tableCellContentBlock', ...(value ? { content: [text(value)] } : {}) }],
});
const tableRoot = (id: string, rows: string[][]) => ({
  type: 'rootBlock',
  attrs: { id },
  content: [{
    type: 'table',
    attrs: { id: `${id}-table` },
    content: rows.map((row, index) => ({
      type: 'tableRow',
      content: row.map(value => cell(index === 0 ? 'tableHeader' : 'tableCell', value)),
    })),
  }],
});
const paragraphRoot = (id: string, value: string) => ({
  type: 'rootBlock',
  attrs: { id },
  content: [{ type: 'baseBlock', attrs: { id: `${id}-body` }, content: [text(value)] }],
});

function createState(content: unknown[]) {
  const plugins = (TableCellCompactExtension.config.addProseMirrorPlugins as () => Plugin[]).call({});
  return EditorState.create({ doc: schema.nodeFromJSON({ type: 'doc', content }), plugins });
}

function compactTexts(state: EditorState): string[] {
  const set = tableCellCompactPluginKey.getState(state) as DecorationSet;
  return set.find().map(decoration => state.doc.nodeAt(decoration.from)?.textContent ?? '?');
}

function positionOfText(state: EditorState, value: string): number {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === value) found = pos;
    return found < 0;
  });
  return found;
}

describe('表格短格 decoration', () => {
  it('单行短文字（含表头与空格）标为短格，长文本不标', () => {
    const state = createState([
      tableRoot('t', [['阶段', '说明'], ['进行中', '这一列是比较长的说明文字，需要换行显示'], ['', '完成']]),
    ]);
    expect(compactTexts(state)).toEqual(['阶段', '说明', '进行中', '', '完成']);
  });

  it('输入让短格变长后只重算这张表，其他表的 decoration 跟随位置映射', () => {
    let state = createState([
      tableRoot('a', [['名称'], ['桌面端']]),
      paragraphRoot('p', '正文'),
      tableRoot('b', [['状态'], ['完成']]),
    ]);
    const at = positionOfText(state, '桌面端') + 3;
    state = state.apply(state.tr.insertText('与移动端的同步策略说明', at));
    expect(compactTexts(state)).toEqual(['名称', '状态', '完成']);

    const back = positionOfText(state, '桌面端与移动端的同步策略说明');
    state = state.apply(state.tr.delete(back + 3, back + 14));
    expect(compactTexts(state)).toEqual(['名称', '桌面端', '状态', '完成']);
  });

  it('改动表外正文不重建表格 decoration', () => {
    let state = createState([tableRoot('a', [['名称'], ['桌面端']]), paragraphRoot('p', '正文')]);
    const before = tableCellCompactPluginKey.getState(state);
    state = state.apply(state.tr.insertText('追加', positionOfText(state, '正文') + 2));
    const after = tableCellCompactPluginKey.getState(state) as DecorationSet;
    expect(after.find()).toHaveLength((before as DecorationSet).find().length);
    expect(compactTexts(state)).toEqual(['名称', '桌面端']);
  });
});
