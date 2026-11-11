import { contrastRatio, parseColor } from '@linnya/color-core';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { resolveTableDefaultFills } from '../engine/table';
import { renderDeck } from './helpers/render-model-mapping-harness';

/** 走 deck.js 编译 → compose JSON 回读 → DeckSpec → RenderModel / PPTX 的真实链路。 */
async function compileTable(table: SandboxJsonObject, colors?: Record<string, string>) {
  const compiled = await compilePresentationComposePayload({
    title: 'Table paint',
    slides: [{ _type: 'Slide', children: [table] }],
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

describe('table border and default fills through compose, preview and native PPTX', () => {
  it('Table.border 经编译回读后仍在，预览每格四边与 PPTX 格线一致', async () => {
    const { deck, node, xml } = await compileTable({
      _type: 'Table', width: 6, headers: ['器物', '年代'], rows: [['后母戊鼎', '商晚期']],
      border: { color: '#8A6A3A', width: 1.5 },
    }, PAPER);

    const element = deck.slides[0].spec.elements[0];
    expect(element).toEqual(expect.objectContaining({
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

  it('不写 fill 时表头和正文的底色跟主题走，预览与 PPTX 相同', async () => {
    const fills = resolveTableDefaultFills(PAPER);
    const { node, xml } = await compileTable({
      _type: 'Table', width: 6, headers: ['器物', '年代'], rows: [['后母戊鼎', { text: '商晚期', fill: '#E9DCC4' }]],
    }, PAPER);

    const header = node.cells.filter(cell => cell.row === 0).map(cell => cell.fill);
    const body = node.cells.filter(cell => cell.row === 1).map(cell => cell.fill);
    expect(header).toEqual([fills.header, fills.header]);
    expect(body).toEqual([PAPER.background, '#E9DCC4']);
    expect(xml).toContain(`<a:srgbClr val="${fills.header.slice(1)}"/>`);
    expect(xml).toContain('<a:srgbClr val="F3EBDD"/>');
    expect(xml).toContain('<a:srgbClr val="E9DCC4"/>');
  });

  it('主题没写颜色时保持白底浅灰表头', async () => {
    const { node } = await compileTable({ _type: 'Table', width: 6, headers: ['A'], rows: [['1']] });
    expect(node.cells.map(cell => cell.fill)).toEqual(['#F2F2F2', '#FFFFFF']);
  });
});

describe('resolveTableDefaultFills', () => {
  it('表头是强调色往底色里淡淡染一层，正文就是底色', () => {
    expect(resolveTableDefaultFills(PAPER)).toEqual({ header: '#E4D9C6', body: '#F3EBDD' });
  });

  it('深色主题的表头仍是深色，浅色文字看得清', () => {
    const fills = resolveTableDefaultFills({ accent1: '#E0B04A', background: '#111418', text: '#F2F2F2' });
    expect(fills.body).toBe('#111418');
    expect(fills.header).toBe('#2E2A1F');
    const header = parseColor(fills.header);
    const text = parseColor('#F2F2F2');
    if (!header || !text) throw new Error('Expected colors');
    expect(contrastRatio(header.channels, text.channels)).toBeGreaterThan(7);
  });

  it('没有强调色时用文字色略压深底色；颜色写法不对就当没写', () => {
    expect(resolveTableDefaultFills({ background: '#FFFFFF', text: '#000000' }).header).toBe('#F2F2F2');
    expect(resolveTableDefaultFills({ accent1: 'brand', background: 'nope' })).toEqual({ header: '#F2F2F2', body: '#FFFFFF' });
  });
});
