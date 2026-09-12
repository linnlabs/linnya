import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile, readPptComposeRawPayload } from '../../sandbox/pptComposeProfile';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../compose/presentationComposeInput';
import { compilePresentationComposePayload } from '../../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { RenderModelMapper } from '../../engine/parser/RenderModelMapper';
import {
  createPresentationBuildWorkerMaterializeRequest,
  materializePresentationPptx,
  parsePresentationBuildWorkerRequest,
} from '../../features/presentationBuildExecution';
import { readPresentationMaterializationInput } from '../../features/presentationBuildExecution/functions/presentationMaterializationCodec';

const SOURCE = `
const slide = createSlide();
slide.add(createFormula({
  latex: String.raw\`x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\`,
  fontSize: 32,
  color: '#1F2A44',
  align: 'center',
  altText: '一元二次方程求根公式',
  position: 'absolute',
  x: 1,
  y: 1.5,
  width: 8,
  height: 2,
}));
const sentence = createText([
  { text: '能量关系 ', style: { bold: true, color: '#A13456' } },
  { formula: 'E = mc^2', style: { fontSize: 24, color: '#1F2A44' } },
  { text: ' 保持在同一段。' },
]);
sentence.position = 'absolute';
sentence.x = 1;
sentence.y = 4;
sentence.width = 8;
sentence.height = 0.8;
sentence.fontSize = 24;
slide.add(sentence);
compose({ title: 'Native Formula', slides: [slide] });
`;

describe('Formula codegen integration', () => {
  it.each(['freeform', 'structured'])('%s 从公开 DSL 经 compose 回读保留富文本、样式与可编辑 OMML', async (kind) => {
    const service = createSandboxService();
    const execution = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'codegen-source',
      source: kind === 'structured'
        ? SOURCE.replace('compose({', `slide.add(createTable({ headers: ['Measure'], rows: [['Energy']], width: 2, height: 1 }));\ncompose({`)
        : SOURCE,
      capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
    });
    expect(execution.success).toBe(true);
    const payload = readPptComposeRawPayload(execution.value);
    expect(payload).not.toBeNull();
    if (!payload) throw new Error('Expected compose payload.');

    // 与生产一致：Worker 的 JSON 输出必须经 Host compiled reader，不能直接使用 Flex 对象。
    const compiled = await compilePresentationComposePayload(payload.rawPayload);
    if (!compiled.ok) throw new Error(compiled.message);
    const readback = readCompiledDirectComposeInput(compiled.input);
    if (!readback.input) throw new Error(readback.error ?? 'Expected compiled input.');
    const deck = buildDeckSpecFromDirectInput(readback.input);
    expect(deck.slides[0].spec.type).toBe(kind);
    expect(deck.slides[0].spec.elements[0]).toEqual(expect.objectContaining({
      type: 'formula',
      source: expect.objectContaining({
        latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
        altText: '一元二次方程求根公式',
      }),
    }));
    expect(deck.slides[0].spec.elements[1]).toEqual(expect.objectContaining({
      type: 'text',
      content: expect.arrayContaining([
        { text: '能量关系 ', style: { bold: true, color: '#A13456' } },
        expect.objectContaining({
          formula: expect.objectContaining({ latex: 'E = mc^2', display: 'inline' }),
        }),
      ]),
    }));

    const renderModel = new RenderModelMapper().fromGeneratedDeck(
      'formula-e2e',
      1,
      deck.title,
      deck,
      { width: 10, height: 5.625 },
    );
    expect(renderModel.slides[0].elements.some(node => node.kind === 'formula')).toBe(true);
    expect(renderModel.slides[0].elements.some(node => (
      node.kind === 'text'
      && node.paragraphs.some(paragraph => paragraph.runs.some(run => run.kind === 'formula'))
    ))).toBe(true);

    const workerRequest = createPresentationBuildWorkerMaterializeRequest({
      requestId: 'formula-e2e',
      materialization: { deckSpec: deck, svgAssets: [], svgFallbacks: [] },
    });
    const parsedRequest = parsePresentationBuildWorkerRequest(workerRequest);
    if (parsedRequest.type !== 'materialize') {
      throw new Error('Expected materialization request.');
    }
    const pptx = await materializePresentationPptx(
      readPresentationMaterializationInput(parsedRequest),
    );
    const zip = await JSZip.loadAsync(pptx);
    const slideFile = zip.file('ppt/slides/slide1.xml');
    if (!slideFile) throw new Error('Expected slide XML.');
    const slideXml = await slideFile.async('text');
    expect(slideXml).toContain('<a14:m>');
    expect(slideXml).toContain('<m:f>');
    expect(slideXml).toContain('<m:rad>');
    expect(slideXml).toContain('能量关系 ');
    expect(slideXml).toContain('A13456');
    expect(slideXml).toContain(' 保持在同一段。');
    expect(slideXml).not.toContain('LINNYA_FORMULA_');
    expect(slideXml).not.toContain('\\frac');
  });
});

function createSandboxService(): SandboxService {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  return new SandboxService(registry, createSandboxEvaluatorTestRunner());
}
