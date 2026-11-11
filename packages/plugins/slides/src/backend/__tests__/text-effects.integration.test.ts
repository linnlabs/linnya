import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import type { RenderNode } from '@plugin/slides/shared';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { renderDeck } from './helpers/render-model-mapping-harness';

/** deck.js Text → compose 回读 → DeckSpec → RenderModel 与原生 PPTX，走真实链路。 */
async function compileSlide(children: SandboxJsonObject[]) {
  const compiled = await compilePresentationComposePayload({ title: 'Text effects', slides: [{ _type: 'Slide', children }] });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const nodes = renderDeck(deck).slides[0].elements;
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected slide XML');
  return { deck, nodes, xml };
}

async function compileError(children: SandboxJsonObject[]): Promise<string> {
  const compiled = await compilePresentationComposePayload({ title: 'Invalid', slides: [{ _type: 'Slide', children }] });
  if (compiled.ok) {
    const parsed = readCompiledDirectComposeInput(compiled.input);
    if (parsed.input) throw new Error('Expected compile failure');
    return parsed.error ?? '';
  }
  return compiled.message;
}

function text(extra: SandboxJsonObject): SandboxJsonObject {
  return { _type: 'Text', content: '金色标题', fontSize: 40, width: 6, height: 1, ...extra };
}

function textRunProperties(xml: string): string[] {
  return xml.match(/<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/g) ?? [];
}

function onlyText(nodes: readonly RenderNode[]) {
  const matches = nodes.filter((node) => node.kind === 'text');
  expect(matches).toHaveLength(1);
  const [node] = matches;
  if (node.kind !== 'text') throw new Error('unreachable');
  return node;
}

const GOLD = {
  type: 'linear',
  angle: 90,
  stops: [{ position: 0, color: '#F6E27A' }, { position: 1, color: '#B8862B' }],
};

describe('文字效果：渐变、空心、字符阴影', () => {
  it('渐变字：DeckSpec 与 RenderModel 带同一份效果，PPTX 每个 rPr 写 gradFill', async () => {
    const { deck, nodes, xml } = await compileSlide([text({ fill: GOLD, shadow: { blur: 6, angle: 90, distance: 2 } })]);

    const element = deck.slides[0].spec.elements[0];
    expect(element).toEqual(expect.objectContaining({
      type: 'text',
      style: expect.objectContaining({ color: '#F6E27A', effects: expect.objectContaining({ fill: expect.objectContaining({ type: 'linear' }) }) }),
    }));
    expect(onlyText(nodes).textEffects).toEqual(expect.objectContaining({
      fill: expect.objectContaining({ type: 'linear', angle: 90 }),
      shadow: expect.objectContaining({ blur: 6 }),
    }));

    const [properties] = textRunProperties(xml);
    expect(properties).toMatch(/^<a:rPr[^>]*><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="F6E27A"\/>/);
    expect(properties).toContain('<a:lin ang="5400000" scaled="1"/>');
    expect(properties).not.toContain('<a:solidFill>');
    // 阴影排在填充之后，dir 90°、默认不透明度 0.3。
    expect(properties).toMatch(/<\/a:gradFill><a:effectLst><a:outerShdw blurRad="76200" dist="25400" dir="5400000"[^>]*><a:srgbClr val="000000"><a:alpha val="30000"\/>/);
    expect(xml).not.toContain('linnya-paint:');
  });

  it('空心字：fill none + 描边，ln 在最前，透明度乘到描边上', async () => {
    const { nodes, xml } = await compileSlide([text({
      content: 'CONTENTS', fill: 'none', stroke: { color: '#1F3A5F', width: 1.5 }, opacity: 0.4,
    })]);

    expect(onlyText(nodes).textEffects).toEqual({
      fill: { type: 'none' },
      stroke: { color: '#1F3A5F', width: 1.5 },
      opacity: 0.4,
    });
    const [properties] = textRunProperties(xml);
    expect(properties).toMatch(/^<a:rPr[^>]*><a:ln w="19050"><a:solidFill><a:srgbClr val="1F3A5F"><a:alpha val="40000"\/><\/a:srgbClr><\/a:solidFill><\/a:ln><a:noFill\/>/);
  });

  it('只加描边和阴影时保留原纯色，顺序仍是 ln → 填充 → effectLst', async () => {
    const { xml } = await compileSlide([text({
      color: '#C0392B', stroke: { color: '#FFFFFF', width: 2 }, shadow: { blur: 0, angle: 45, distance: 3, color: '#222222', opacity: 0.6 },
    })]);
    const [properties] = textRunProperties(xml);
    expect(properties).toMatch(/^<a:rPr[^>]*><a:ln w="25400">[\s\S]*?<\/a:ln><a:solidFill><a:srgbClr val="C0392B"\/><\/a:solidFill><a:effectLst>/);
    expect(properties).toContain('<a:alpha val="60000"/>');
  });

  it('富文本各段都带效果；段落不能另写 color', async () => {
    const { xml } = await compileSlide([text({
      content: [{ text: '上' }, { text: '下', style: { bold: true } }],
      fill: GOLD,
    })]);
    expect(textRunProperties(xml).filter((properties) => properties.includes('<a:gradFill'))).toHaveLength(2);

    expect(await compileError([text({ content: [{ text: '上', style: { color: '#FF0000' } }], fill: GOLD })])).toMatch(/color/);
  });

  it('写错直接报错：fill 与 color 同写、纯色 fill、空心不描边、透明度越界', async () => {
    expect(await compileError([text({ fill: GOLD, color: '#000000' })])).toMatch(/fill/);
    expect(await compileError([text({ fill: { type: 'radial', stops: GOLD.stops } })])).toMatch(/线性渐变/);
    expect(await compileError([text({ fill: 'none' })])).toMatch(/stroke/);
    expect(await compileError([text({ stroke: { color: '#000000', width: 0 } })])).toMatch(/width/);
    expect(await compileError([text({ opacity: 1.5 })])).toMatch(/opacity/);
  });
});
