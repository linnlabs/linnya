import { contrastRatio, parseColor } from '@linnya/color-core';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { resolveTableDefaultFills, resolveTableTextColor } from '../engine/table';
import { renderDeck } from './helpers/render-model-mapping-harness';

/** 走 deck.js 编译 → compose JSON 回读 → DeckSpec → RenderModel / PPTX 的真实链路。 */
async function compileTable(table: SandboxJsonObject, colors?: Record<string, string>, pageColor?: string) {
  const compiled = await compilePresentationComposePayload({
    title: 'Table paint',
    slides: [{ _type: 'Slide', ...(pageColor ? { background: pageColor } : {}), children: [table] }],
    ...(colors ? { theme: { colors } } : {}),
  });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const node = renderDeck(deck).slides[0].elements.find(element => element.kind === 'table');
  if (!node || node.kind !== 'table') throw new Error('Expected table');
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected native table XML');
  return { deck, node, xml };
}

const PAPER = { accent1: '#8A6A3A', background: '#F3EBDD', text: '#2B2118' };
const TABLE: SandboxJsonObject = { _type: 'Table', width: 6, headers: ['器物', '年代'], rows: [['后母戊鼎', '商晚期']] };

function contrast(left: string, right: string): number {
  const a = parseColor(left);
  const b = parseColor(right);
  if (!a || !b) throw new Error(`Expected colors ${left} ${right}`);
  return contrastRatio(a.channels, b.channels);
}

function cellPaint(node: { cells: readonly { row: number; fill?: string; paragraphs: readonly { runs: readonly { kind?: string; color?: string }[] }[] }[] }) {
  return node.cells.map(cell => ({ row: cell.row, fill: cell.fill, color: cell.paragraphs[0].runs[0].color }));
}

describe('table border and default fills through compose, preview and native PPTX', () => {
  it('Table.border 经编译回读后仍在，预览每格四边与 PPTX 格线一致', async () => {
    const { deck, node, xml } = await compileTable({ ...TABLE, border: { color: '#8A6A3A', width: 1.5 } }, PAPER, PAPER.background);

    expect(deck.slides[0].spec.elements[0]).toEqual(expect.objectContaining({
      type: 'table',
      border: { width: 1.5, paint: { type: 'solid', color: '#8A6A3A' } },
    }));
    for (const cell of node.cells) {
      expect(cell.borders?.top?.paint).toEqual({ type: 'solid', color: '#8A6A3A' });
      expect(cell.borders?.left?.width).toBe(1.5);
    }
    expect(xml).toContain('<a:lnT w="19050"');
    expect(xml.match(/<a:srgbClr val="8A6A3A"\/>/g)?.length).toBeGreaterThanOrEqual(node.cells.length * 4);
  });

  it('不写 fill 时正文取所在页底色、表头染一层强调色，字用主题文字色；预览与 PPTX 相同', async () => {
    const fills = resolveTableDefaultFills(PAPER, PAPER.background);
    const { node, xml } = await compileTable({
      ...TABLE, rows: [['后母戊鼎', { text: '商晚期', fill: '#E9DCC4' }]],
    }, PAPER, PAPER.background);

    expect(cellPaint(node)).toEqual([
      { row: 0, fill: fills.header, color: PAPER.text },
      { row: 0, fill: fills.header, color: PAPER.text },
      { row: 1, fill: PAPER.background, color: PAPER.text },
      { row: 1, fill: '#E9DCC4', color: PAPER.text },
    ]);
    for (const color of [fills.header, PAPER.background, '#E9DCC4', PAPER.text]) {
      expect(xml).toContain(`<a:srgbClr val="${color.slice(1)}"/>`);
    }
  });

  it('浅色主题里的一页黑底：表格贴着黑页，字自动换成看得清的浅色', async () => {
    const { node, xml } = await compileTable(TABLE, PAPER, '#000000');
    const paint = cellPaint(node);
    expect(paint.filter(cell => cell.row === 1).map(cell => cell.fill)).toEqual(['#000000', '#000000']);
    for (const cell of paint) {
      expect(contrast(cell.color!, cell.fill!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(paint[0].fill).not.toBe('#000000');
    expect(xml).toContain('<a:srgbClr val="FFFFFF"/>');
  });

  it('深色主题但页面没写背景（白页）时，表格跟白页走，不用主题深底', async () => {
    const dark = { accent1: '#E0B04A', background: '#111418', text: '#F2F2F2' };
    const paint = cellPaint((await compileTable(TABLE, dark)).node);
    expect(paint.filter(cell => cell.row === 1).map(cell => cell.fill)).toEqual(['#FFFFFF', '#FFFFFF']);
    for (const cell of paint) expect(contrast(cell.color!, cell.fill!)).toBeGreaterThanOrEqual(4.5);
  });

  it('逐格写了深色 fill 却没写字色时，字自动反白；写了字色就照写的', async () => {
    const paint = cellPaint((await compileTable({
      ...TABLE,
      headers: [{ text: '器物', fill: '#5B3A1E' }, { text: '年代', fill: '#5B3A1E', style: { color: '#E0B04A' } }],
    }, PAPER, PAPER.background)).node);
    expect(paint[0]).toEqual({ row: 0, fill: '#5B3A1E', color: '#FFFFFF' });
    expect(paint[1]).toEqual({ row: 0, fill: '#5B3A1E', color: '#E0B04A' });
  });

  it('主题和页面都没写颜色时保持白底浅灰表头、默认深灰字', async () => {
    const paint = cellPaint((await compileTable({ _type: 'Table', width: 6, headers: ['A'], rows: [['1']] })).node);
    expect(paint).toEqual([
      { row: 0, fill: '#F2F2F2', color: '#333333' },
      { row: 1, fill: '#FFFFFF', color: '#333333' },
    ]);
  });
});

describe('resolveTableDefaultFills / resolveTableTextColor', () => {
  it('正文优先取页面底色，读不出页面底色时取主题底色', () => {
    expect(resolveTableDefaultFills(PAPER, PAPER.background)).toEqual({ header: '#E4D9C6', body: '#F3EBDD' });
    expect(resolveTableDefaultFills(PAPER, undefined).body).toBe('#F3EBDD');
    expect(resolveTableDefaultFills(PAPER, '#000000').body).toBe('#000000');
  });

  it('深底的表头仍是深色，没有强调色时往浅处提一点', () => {
    const tinted = resolveTableDefaultFills({ accent1: '#E0B04A' }, '#111418');
    expect(contrast(tinted.header, '#FFFFFF')).toBeGreaterThan(7);
    expect(resolveTableDefaultFills(undefined, '#000000').header).toBe('#0D0D0D');
    expect(resolveTableDefaultFills({ background: '#FFFFFF', text: '#000000' }).header).toBe('#F2F2F2');
  });

  it('字色：主题文字色够清楚就用它，不够就退到深灰，深底上反白；颜色写法不对就当没写', () => {
    expect(resolveTableTextColor('#F3EBDD', PAPER)).toBe(PAPER.text);
    expect(resolveTableTextColor('#F3EBDD', { text: '#F2F2F2' })).toBe('#333333');
    expect(resolveTableTextColor('#111418', PAPER)).toBe('#FFFFFF');
    expect(resolveTableTextColor('#111418', { text: '#F2F2F2' })).toBe('#F2F2F2');
    expect(resolveTableDefaultFills({ accent1: 'brand', background: 'nope' })).toEqual({ header: '#F2F2F2', body: '#FFFFFF' });
  });
});
