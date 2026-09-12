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
  const pptx = await materializePresentationPptx({ deckSpec: deck, svgAssets: [], svgFallbacks: [] });
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
