import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { renderDeck } from './helpers/render-model-mapping-harness';
import { resolveTableCellLayouts } from '@plugin/slides/shared';

async function compileTable(table: SandboxJsonObject) {
  const compiled = await compilePresentationComposePayload({ title: 'Table geometry', slides: [{
    _type: 'Slide', children: [table, { _type: 'Text', content: 'Following flow', height: 0.5 }],
  }] });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const model = renderDeck(deck);
  const node = model.slides[0].elements.find(element => element.kind === 'table');
  if (!node || node.kind !== 'table') throw new Error('Expected table');
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected native table XML');
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const rows = Array.from(document.getElementsByTagName('a:tr')).map(row => Number(row.getAttribute('h')) / 914400);
  const columns = Array.from(document.getElementsByTagName('a:gridCol')).map(col => Number(col.getAttribute('w')) / 914400);
  expect(rows).toHaveLength(node.rows.length);
  rows.forEach((height, index) => expect(height).toBeCloseTo(node.rows[index], 5));
  columns.forEach((width, index) => expect(width).toBeCloseTo(node.columns[index], 5));
  expect(node.rows.reduce((a, b) => a + b, 0)).toBeCloseTo(node.box.h, 8);
  expect(node.columns.reduce((a, b) => a + b, 0)).toBeCloseTo(node.box.w, 8);
  return { deck, model, node, document };
}

describe('generated table intrinsic layout through compose, preview and native PPTX', () => {
  it('未声明高度的表格按文本换行及字号占据正常流，表头与正文均有可见行高', async () => {
    const { node, model, document } = await compileTable({
      _type: 'Table', width: 4, headers: ['方法说明', '均值'],
      rows: [
        [{ text: 'Exact\nnon-censored\nobservations', style: { fontSize: 18 } }, '5.1111'],
        ['Sensitivity', '4.8500'],
      ],
    });
    expect(node.box.h).toBeGreaterThan(0.9);
    expect(node.rows.every(height => height > 0)).toBe(true);
    expect(node.rows[1]).toBeGreaterThan(node.rows[2]);
    const following = model.slides[0].elements.find(element => element.kind === 'text');
    expect(following?.box.y).toBeCloseTo(node.box.y + node.box.h, 5);
    expect(Array.from(document.getElementsByTagName('a:t')).map(text => text.textContent))
      .toEqual(expect.arrayContaining(['方法说明', '均值', '5.1111', '4.8500']));
  });

  it('显式小高度只压缩同一格线事实，不额外制造出盒正文或吞掉首行', async () => {
    const { node } = await compileTable({
      _type: 'Table', width: 4, height: 0.05, headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']],
    });
    expect(node.box.h).toBeCloseTo(0.05, 5);
    expect(node.rows.every(height => height > 0 && height < 0.05)).toBe(true);
  });

  it('压缩表格的字号按同一比例写进预览和 PPTX（PowerPoint 表格不会缩字，只会撑高行）', async () => {
    const { node, document } = await compileTable({
      _type: 'Table', width: 4, height: 1.2, headers: ['序号', '值'],
      rows: [
        [{ text: '第 1 行', style: { fontSize: 14 } }, '0'],
        ...Array.from({ length: 11 }, (_, index) => [`第 ${index + 2} 行`, String(index)]),
      ],
    });
    const runSizes = (row: number, col: number) => node.cells
      .find(cell => cell.row === row && cell.col === col)?.paragraphs[0]?.runs[0]?.fontSize;
    const header = runSizes(0, 0) ?? 0;
    const body = runSizes(2, 0) ?? 0;
    const explicit = runSizes(1, 0) ?? 0;
    expect(body).toBeLessThan(9.5);
    expect(header).toBeLessThan(10);
    expect(explicit).toBeLessThan(14);
    expect(explicit / body).toBeCloseTo(14 / 9.5, 1);
    // PPTX 每格写同一组字号（sz 单位为百分之一磅）。
    const pptxSizes = Array.from(document.getElementsByTagName('a:tc')).map(cell =>
      Number(cell.getElementsByTagName('a:rPr')[0]?.getAttribute('sz')) / 100);
    expect(pptxSizes[0]).toBeCloseTo(header, 5);
    expect(pptxSizes[2]).toBeCloseTo(explicit, 5);
    expect(pptxSizes[4]).toBeCloseTo(body, 5);
  });

  it('列宽比例与单元格内边距穿过 compose 回读，预览与 PPTX 拿到同一组列宽和边距', async () => {
    const { deck, node, document } = await compileTable({
      _type: 'Table', width: 6, headers: ['公元', '窑业', '说明'],
      rows: [['960', '定窑', '北宋立国，定窑进入盛期'], ['1127', '磁州窑', '南迁之后北方民窑延续']],
      columnWidths: [1, 1, 4], cellPadding: { x: 0.12, y: 0.04 },
    });
    const spec = deck.slides[0].spec;
    const element = spec.type === 'structured'
      ? spec.elements.find(candidate => candidate.type === 'table')
      : undefined;
    expect(element).toMatchObject({ columnWidths: [1, 1, 4], cellPadding: { x: 0.12, y: 0.04 } });
    // 比例之和等于表格宽度时就是逐列英寸；compileTable 已核对 PPTX gridCol 与预览列宽一致。
    expect(node.columns[0]).toBeCloseTo(1, 5);
    expect(node.columns[1]).toBeCloseTo(1, 5);
    expect(node.columns[2]).toBeCloseTo(4, 5);
    expect(node.cells[0]?.padding).toEqual({ top: 0.04, right: 0.12, bottom: 0.04, left: 0.12 });
    const margins = Array.from(document.getElementsByTagName('a:tcPr')).map(cell => ({
      left: Number(cell.getAttribute('marL')) / 914400,
      top: Number(cell.getAttribute('marT')) / 914400,
    }));
    expect(margins).toHaveLength(9);
    for (const margin of margins) {
      expect(margin.left).toBeCloseTo(0.12, 4);
      expect(margin.top).toBeCloseTo(0.04, 4);
    }
  });

  it('列宽比例不随表格宽度固定为英寸：盒宽变化时按比例分配；更大的上下边距让自动高度变高', async () => {
    const { node } = await compileTable({
      _type: 'Table', width: 3, rows: [['A', 'B', 'C']], columnWidths: [1, 1, 4],
    });
    expect(node.columns.map(width => width / 3)).toEqual([
      expect.closeTo(1 / 6, 5), expect.closeTo(1 / 6, 5), expect.closeTo(4 / 6, 5),
    ]);
    const compact = await compileTable({ _type: 'Table', width: 4, rows: [['A', 'B']] });
    const roomy = await compileTable({
      _type: 'Table', width: 4, rows: [['A', 'B']], cellPadding: { y: 0.15 },
    });
    expect(roomy.node.box.h).toBeGreaterThan(compact.node.box.h + 0.15);
  });

  it('压缩的表格按同一比例缩小作者写的内边距，预览与 PPTX 一致', async () => {
    const { node, document } = await compileTable({
      _type: 'Table', width: 4, height: 0.6, cellPadding: 0.1,
      rows: Array.from({ length: 6 }, (_, index) => [`第 ${index + 1} 行`, String(index)]),
    });
    const padding = node.cells[0]?.padding;
    expect(padding?.left).toBeLessThan(0.1);
    expect(padding?.left).toBeCloseTo(padding?.top ?? 0, 8);
    const firstMargin = Number(document.getElementsByTagName('a:tcPr')[0]?.getAttribute('marL')) / 914400;
    expect(firstMargin).toBeCloseTo(padding?.left ?? 0, 4);
  });

  it('自动尺寸测量与渲染共同跳过跨行合并占据的列，保留跨列和换行内容', async () => {
    const { node } = await compileTable({
      _type: 'Table', width: 4,
      rows: [
        [{ text: 'Merged\ncohort', rowspan: 2 }, { text: 'Two measures', colspan: 2 }],
        ['Mean', 'Interval'],
      ],
    });
    const cells = resolveTableCellLayouts(node);
    const mean = cells.find(cell => cell.cell.paragraphs[0]?.runs[0]?.text === 'Mean');
    expect(mean?.cell.col).toBe(1);
    const merged = cells.find(cell => cell.cell.rowSpan === 2);
    expect(merged?.height).toBeCloseTo(node.box.h, 6);
  });
});
