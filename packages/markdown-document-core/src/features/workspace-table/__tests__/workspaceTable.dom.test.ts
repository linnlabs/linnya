// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceMarkdownSchemaLite } from '../../workspace-schema';
import {
  applyWorkspaceTableStyle,
  estimateTableTextWidthEm,
  fitStaticWorkspaceTable,
  fitWorkspaceTable,
  isCompactTableCellElement,
  isCompactTableCellNode,
  isCompactTableCellText,
  readWorkspaceTableStyle,
  syncWorkspaceTableScroll,
  WORKSPACE_TABLE_COMPACT_CELL_CLASS,
  WORKSPACE_TABLE_STYLES,
  workspaceTableStyleAttributes,
} from '../index';

const text = (value: string) => ({ type: 'text', text: value });
function cellNode(content: unknown[], blocks = 1) {
  return workspaceMarkdownSchemaLite.nodeFromJSON({
    type: 'tableCell',
    content: Array.from({ length: blocks }, () => ({ type: 'tableCellContentBlock', ...(content.length ? { content } : {}) })),
  });
}

/** jsdom 没有布局：用表格“自然宽度”模拟内容，收紧档减去固定像素，验证定级顺序而不是排版。 */
function layoutTable(naturalWidth: number, tightWidth: number, availableWidth: number) {
  const scroller = document.createElement('div');
  const table = document.createElement('table');
  table.className = 'table-block';
  table.innerHTML = '<colgroup><col style="width: 300px"></colgroup><tbody><tr><td class="table-cell--compact"><p class="table-cell-content-block">桌面端</p></td></tr></tbody>';
  table.style.width = '900px';
  scroller.append(table);
  document.body.append(scroller);
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => availableWidth });
  Object.defineProperty(table, 'offsetWidth', {
    configurable: true,
    get: () => (table.getAttribute('data-table-fit') ? tightWidth : naturalWidth),
  });
  return { scroller, table };
}

afterEach(() => document.body.replaceChildren());

describe('短格判定', () => {
  it('按字符类别估算视觉宽度：中文 1em、数字 0.6em、西文 0.55em', () => {
    expect(estimateTableTextWidthEm('桌面端')).toBe(3);
    expect(estimateTableTextWidthEm('2026')).toBeCloseTo(2.4);
    expect(estimateTableTextWidthEm('Done')).toBeCloseTo(2.2);
  });

  it('不超过 8em 的单行文字是短格；超过或含换行就是长格；空格算短格', () => {
    expect(isCompactTableCellText('进行中')).toBe(true);
    expect(isCompactTableCellText('')).toBe(true);
    expect(isCompactTableCellText('一二三四五六七八')).toBe(true);
    expect(isCompactTableCellText('一二三四五六七八九')).toBe(false);
    expect(isCompactTableCellText('甲\n乙')).toBe(false);
  });

  it('正式节点：只含文字（可带 mark）的单个内容块；换行、公式、引用与多内容块都按长格', () => {
    expect(isCompactTableCellNode(cellNode([{ ...text('完成'), marks: [{ type: 'bold' }] }]))).toBe(true);
    expect(isCompactTableCellNode(cellNode([]))).toBe(true);
    expect(isCompactTableCellNode(cellNode([text('甲'), { type: 'hardBreak' }, text('乙')]))).toBe(false);
    expect(isCompactTableCellNode(cellNode([{ type: 'inlineLatex', attrs: { latexSource: 'x' } }]))).toBe(false);
    expect(isCompactTableCellNode(cellNode([text('甲')], 2))).toBe(false);
  });

  it('只读 HTML 与节点同一规则：行内 mark 可以，带 class 的行内节点外壳、换行和多内容块不行', () => {
    const cell = (html: string) => {
      const element = document.createElement('td');
      element.innerHTML = html;
      return element;
    };
    expect(isCompactTableCellElement(cell('<div class="table-cell-content-block"><strong>完成</strong></div>'))).toBe(true);
    expect(isCompactTableCellElement(cell('<div class="table-cell-content-block"><span style="color: red">风险</span></div>'))).toBe(true);
    expect(isCompactTableCellElement(cell('<div class="table-cell-content-block">甲<br>乙</div>'))).toBe(false);
    expect(isCompactTableCellElement(cell('<div class="table-cell-content-block"><span class="markdown-document-reference">文档</span></div>'))).toBe(false);
    expect(isCompactTableCellElement(cell('<div class="table-cell-content-block">甲</div><div class="table-cell-content-block">乙</div>'))).toBe(false);
  });
});

describe('分级退让', () => {
  it('放得下保持标准档，不写属性', () => {
    const { table, scroller } = layoutTable(600, 560, 704);
    expect(fitWorkspaceTable(table, scroller)).toBe('normal');
    expect(table.hasAttribute('data-table-fit')).toBe(false);
  });

  it('标准档放不下、收紧后放得下时只收紧', () => {
    const { table, scroller } = layoutTable(720, 690, 704);
    expect(fitWorkspaceTable(table, scroller)).toBe('tight');
    expect(table.getAttribute('data-table-fit')).toBe('tight');
  });

  it('宽度变宽后重新定级回到标准档', () => {
    const { table, scroller } = layoutTable(720, 690, 704);
    fitWorkspaceTable(table, scroller);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => 900 });
    expect(fitWorkspaceTable(table, scroller)).toBe('normal');
    expect(table.hasAttribute('data-table-fit')).toBe(false);
  });

  it('收紧后仍放不下：交互表面横向滚动，短格与列宽保持不变', () => {
    const { table, scroller } = layoutTable(1200, 1100, 704);
    expect(fitWorkspaceTable(table, scroller)).toBe('scroll');
    expect(table.querySelector(`.${WORKSPACE_TABLE_COMPACT_CELL_CLASS}`)).not.toBeNull();
    expect(table.style.width).toBe('900px');
  });

  it('收紧后仍放不下：纸面改为全部可换行，去掉短格、存储列宽与固定表宽', () => {
    const { table, scroller } = layoutTable(1200, 1100, 704);
    expect(fitWorkspaceTable(table, scroller, { overflow: 'wrap' })).toBe('wrap');
    expect(table.getAttribute('data-table-fit')).toBe('wrap');
    expect(table.querySelector(`.${WORKSPACE_TABLE_COMPACT_CELL_CLASS}`)).toBeNull();
    expect(table.querySelector('col')?.style.width).toBe('');
    expect(table.style.width).toBe('100%');
  });

  it('纸面逐列放开短格：最宽的列先折行，放得下就停，两字表头保持单行', () => {
    const scroller = document.createElement('div');
    const table = document.createElement('table');
    table.className = 'table-block';
    const row = (cells: string[]) => `<tr>${cells.map(text => `<td class="table-cell--compact"><p class="table-cell-content-block">${text}</p></td>`).join('')}</tr>`;
    table.innerHTML = `<tbody>${row(['产品线', '一月', '备注'])}${row(['插件市场', '12', '十一月新版发布'])}</tbody>`;
    scroller.append(table);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => 600 });
    // 每个仍是短格的列按 300px 计：三列 900 放不下，放开一列后 600 刚好放下。
    Object.defineProperty(table, 'offsetWidth', {
      configurable: true,
      get: () => new Set(Array.from(table.querySelectorAll('.table-cell--compact')).map(cell => (cell as HTMLTableCellElement).cellIndex)).size * 300,
    });
    expect(fitWorkspaceTable(table, scroller, { overflow: 'wrap' })).toBe('wrap');
    const stillCompact = Array.from(table.querySelectorAll('.table-cell--compact')).map(cell => cell.textContent);
    expect(stillCompact).toEqual(['产品线', '一月', '插件市场', '12']);
  });

  it('还没有布局（可用宽度为 0）时保持原状，不误判为宽表', () => {
    const { table, scroller } = layoutTable(1200, 1100, 0);
    expect(fitWorkspaceTable(table, scroller)).toBe('normal');
    expect(table.hasAttribute('data-table-fit')).toBe(false);
  });

  it('横向滚动记录位置，滚到底后渐隐取消；不滚动的表不带位置', () => {
    const { table, scroller } = layoutTable(1200, 1100, 704);
    let scrollLeft = 0;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => 1100 });
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => scrollLeft });
    expect(fitStaticWorkspaceTable(table, scroller)).toBe('scroll');
    expect(table.getAttribute('data-table-scroll')).toBe('start');
    scrollLeft = 200;
    scroller.dispatchEvent(new Event('scroll'));
    expect(table.getAttribute('data-table-scroll')).toBe('middle');
    scrollLeft = 396;
    scroller.dispatchEvent(new Event('scroll'));
    expect(table.getAttribute('data-table-scroll')).toBe('end');

    table.removeAttribute('data-table-fit');
    syncWorkspaceTableScroll(table, scroller);
    expect(table.hasAttribute('data-table-scroll')).toBe(false);
  });
});

describe('表格样式预设', () => {
  const table = (attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [{ type: 'rootBlock', attrs: { id: 'root' }, content: [{ type: 'table', attrs, content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'tableCellContentBlock', content: [text('格')] }] }] },
    ] }] }],
  });

  it('正式 schema 缺省为默认样式，只接受六种预设', () => {
    expect(workspaceMarkdownSchemaLite.nodeFromJSON(table({})).firstChild?.firstChild?.attrs.tableStyle).toBe('default');
    for (const style of WORKSPACE_TABLE_STYLES) {
      expect(workspaceMarkdownSchemaLite.nodeFromJSON(table({ tableStyle: style })).firstChild?.firstChild?.attrs.tableStyle).toBe(style);
    }
    expect(() => workspaceMarkdownSchemaLite.nodeFromJSON(table({ tableStyle: 'rainbow' }))).toThrow('not a known preset');
  });

  it('默认样式不写 DOM 属性，无法识别的值按默认显示', () => {
    expect(readWorkspaceTableStyle(undefined)).toBe('default');
    expect(readWorkspaceTableStyle('rainbow')).toBe('default');
    expect(workspaceTableStyleAttributes('default')).toEqual({});
    expect(workspaceTableStyleAttributes('three-line')).toEqual({ 'data-table-style': 'three-line' });
    const element = document.createElement('table');
    applyWorkspaceTableStyle(element, 'banded');
    expect(element.getAttribute('data-table-style')).toBe('banded');
    applyWorkspaceTableStyle(element, 'default');
    expect(element.hasAttribute('data-table-style')).toBe(false);
  });
});
