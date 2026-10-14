import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PresentationRenderModel, RenderNode, SlidesManualEditsInput, SvgGraphicOwnedAssetRef, SvgGraphicResolvedAsset } from '@plugin/slides/shared';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile, readPptComposeRawPayload, typecheckCodegenSource } from '../../sandbox';
import { compileFlexInput, initYoga, isFlexComposeInput } from '../compose/flex-layout';
import { ownSvgGraphicSources } from '../compose/ownSvgGraphicSources';
import { buildDeckSpecFromDirectInput } from '../compose/presentationComposeInput';
import { admitSvgGraphic } from '../../engine/svgGraphic';
import { DeckAssembler } from '../../engine/DeckAssembler';
import { FreeformCompiler } from '../../engine/FreeformCompiler';
import { StructuredCompiler } from '../../engine/StructuredCompiler';
import { RenderModelMapper } from '../../engine/parser/RenderModelMapper';
import { PptxReader } from '../../engine/parser/PptxReader';
import { applyTextLayoutToRenderModel } from '../../engine/text/renderModelTextLayout';
import { SpatialAnalyzer } from '../../engine/quality/SpatialAnalyzer';
import { buildToolFeedbackPayload } from '../../tools/inspectFeedback/feedbackPayload';

const source = readFileSync(path.resolve(
  import.meta.dirname, '../../../../resources/skills/slides-design/references/examples/svg-graphic.js',
), 'utf8');

async function compileExample(manualEdits?: SlidesManualEditsInput) {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
  const result = await sandbox.execute({
    profileId: 'ppt_compose', language: 'javascript', source,
    inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
  });
  if (!result.success) throw new Error(`SVG example sandbox failed: ${JSON.stringify(result.error)}`);
  const payload = readPptComposeRawPayload(result.value);
  if (!payload || !isFlexComposeInput(payload.rawPayload)) throw new Error('Expected Flex source');
  await initYoga();
  const compiled = compileFlexInput({ ...payload.rawPayload, manualEdits });
  if (!compiled.input || compiled.rejectedSlides?.length) throw new Error(compiled.error ?? JSON.stringify(compiled.rejectedSlides));

  // 本测试仅替换资产 I/O；SVG admission、Flex、DeckSpec 和 PPTX writer 均走生产实现。
  const assets = new Map<string, SvgGraphicResolvedAsset>();
  const owned = await ownSvgGraphicSources(compiled.input, {
    async ownSource(source) {
      if (source.kind !== 'inline_svg') throw new Error('The example must be self-contained');
      const report = admitSvgGraphic(source.svg);
      const ref: SvgGraphicOwnedAssetRef = {
        kind: 'owned_svg', assetId: report.contentHash, contentHash: report.contentHash,
        byteLength: report.metrics.bytes, viewBox: report.viewBox,
      };
      assets.set(ref.assetId, { ...ref, canonicalSvg: report.canonicalSvg });
      return ref;
    },
  }, { documentId: 'svg-example' });
  const deck = buildDeckSpecFromDirectInput(owned);
  const renderModel = new RenderModelMapper().fromGeneratedDeck(
    'svg-example', 1, deck.title, deck, { width: 10, height: 5.625 }, {}, assets,
  );
  const assembler = new DeckAssembler(new StructuredCompiler(), new FreeformCompiler(), undefined, undefined, {
    async resolveSvgGraphicAsset(ref) {
      const asset = assets.get(ref.assetId);
      if (!asset) throw new Error('Expected owned example asset');
      return asset;
    },
  }, {
    // 浏览器像素由 raster smoke 验证；此处只验证矢量媒体和原生文本的 package 语义。
    async rasterizeSvgGraphic() {
      return {
        pngBytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y5WQAAAABJRU5ErkJggg==', 'base64'),
        widthPx: 1, heightPx: 1,
      };
    },
  });
  return { deck, assets, renderModel, assembler };
}

describe('SVG Graphic runnable example', () => {
  it('compiles the source into an owned vector with aligned native, editable labels and a real PPTX', async () => {
    const checked = typecheckCodegenSource(source);
    if (!checked.ok) throw new Error(checked.message);
    const { deck, assets, renderModel, assembler } = await compileExample();
    expect(JSON.stringify(deck)).not.toContain('<svg');
    const [asset] = assets.values();
    const admitted = admitSvgGraphic(asset.canonicalSvg);
    expect(admitted.facts).toEqual({ hasGradient: true, hasMarker: true, hasTransform: true });
    expect(admitted.metrics.elementNames.rect).toBe(3);
    expect(asset.canonicalSvg).not.toMatch(/<(?:text|tspan|use|symbol)\b/);
    expect(asset.canonicalSvg).toContain(`stroke="${deck.theme?.colors?.accent1}"`);

    const nodes = renderModel.slides[0].elements;
    const graphic = nodes.find(node => node.kind === 'svgGraphic');
    expect(graphic?.authoringAncestorRefs).toEqual([
      { slideKey: 'pipeline-overview', editKey: 'pipeline', targetKind: 'frame' },
    ]);
    const labels = nodes.filter(node => node.authoringRef?.editKey.startsWith('label-'));
    expect(labels).toHaveLength(3);
    for (const [index, label] of labels.entries()) {
      expect(label.kind).toBe('text');
      // 同比例 Frame 没有 contain 留白，页面坐标只有 Frame 位移与单位换算。
      expect(label.box.x + label.box.w / 2).toBeCloseTo(0.5 + (165 + index * 285) / 100, 5);
      expect(label.box.y + label.box.h / 2).toBeCloseTo(1.4 + 140 / 100, 5);
      expect(label.authoringAncestorRefs).toEqual(graphic?.authoringAncestorRefs);
      expect(label.authoringEdit?.capabilities).toContain('set_text_content');
    }
    const exported = await new PptxReader().parse(await assembler.assemble(deck));
    expect(exported.slides[0].elements.filter(element => element.type === 'svgGraphic')).toHaveLength(1);
    const nativeText = exported.slides[0].elements.filter(element => element.type === 'text').map(element => element.text);
    expect(nativeText).toEqual(expect.arrayContaining(['采集', '处理', '交付']));
  });

  it('reports Frame diagram overlays consistently in findings and spatial relations without hiding real collisions', async () => {
    const { renderModel } = await compileExample();
    const baseline = await inspectExample(renderModel);
    expect(baseline.findings.filter(finding => finding.code === 'element_overlap')).toHaveLength(0);
    expect(baseline.sceneGraph[0]?.rootNode.children.find(node => node.kind === 'svgGraphic')?.authoringFrameId)
      .toBe('authoring-pipeline-overview-pipeline');
    const graphicId = 'authoring-pipeline-overview-pipeline-art';
    const labelId = 'authoring-pipeline-overview-label-collect';
    expect(baseline.spatialAnalysis[0]?.relations.find(relation => relation.type === 'overlap'
      && relation.nodeIds.includes(graphicId) && relation.nodeIds.includes(labelId))?.overlapType).toBe('container');

    // 真实示例物化之后改变关系事实，两个诊断入口必须共同保留这些反例。
    const variants: Array<{ name: string; change: (nodes: RenderNode[]) => void; pair: string[] }> = [
      { name: 'unowned', change: nodes => { requireNode(nodes, 'label-collect').authoringAncestorRefs = undefined; }, pair: [graphicId, labelId] },
      { name: 'different Frame', change: nodes => {
        requireNode(nodes, 'label-collect').authoringAncestorRefs = [{ slideKey: 'pipeline-overview', editKey: 'other', targetKind: 'frame' }];
      }, pair: [graphicId, labelId] },
      { name: 'SVG above label', change: nodes => { requireNode(nodes, 'pipeline-art').zIndex = 10; }, pair: [graphicId, labelId] },
      { name: 'partial containment', change: nodes => { requireNode(nodes, 'label-collect').box.x = 8.5; }, pair: [graphicId, labelId] },
      { name: 'rotated SVG', change: nodes => { requireNode(nodes, 'pipeline-art').rotation = 30; }, pair: [graphicId, labelId] },
      { name: 'label collision', change: nodes => {
        requireNode(nodes, 'label-process').box = { ...requireNode(nodes, 'label-collect').box };
      }, pair: [labelId, 'authoring-pipeline-overview-label-process'] },
    ];
    for (const variant of variants) {
      const changed = structuredClone(renderModel);
      variant.change(changed.slides[0].elements);
      const feedback = await inspectExample(changed);
      expect(feedback.findings.some(finding => finding.code === 'element_overlap'
        && variant.pair.every(id => finding.evidence.nodes.some(node => node.nodeId === id))), variant.name).toBe(true);
      expect(feedback.spatialAnalysis[0]?.relations.find(relation => relation.type === 'overlap'
        && variant.pair.every(id => relation.nodeIds.includes(id)))?.overlapType, variant.name).toBe('forbidden');
    }
  });

  it('moves the complete Frame, edits one label and deletes the diagram through existing author identities', async () => {
    const baseline = await compileExample();
    const edited = await compileExample({ version: 2, slides: [{ slideKey: 'pipeline-overview', targets: [
      { kind: 'frame', editKey: 'pipeline', translation: { dx: 0.2, dy: -0.1 } },
      { kind: 'text', editKey: 'label-process', content: '审核', fontSizePt: 17, color: '#914600' },
    ] }] });
    const before = baseline.renderModel.slides[0].elements;
    const after = edited.renderModel.slides[0].elements;
    for (const original of before.filter(node => node.authoringAncestorRefs?.some(ref => ref.editKey === 'pipeline'))) {
      const moved = after.find(node => node.authoringRef?.editKey === original.authoringRef?.editKey);
      if (!moved) throw new Error('Frame descendant lost its author identity');
      expect(moved.box.x).toBeCloseTo(original.box.x + 0.2, 5);
      expect(moved.box.y).toBeCloseTo(original.box.y - 0.1, 5);
    }
    expect([...edited.assets.keys()]).toEqual([...baseline.assets.keys()]);
    const exported = await new PptxReader().parse(await edited.assembler.assemble(edited.deck));
    expect(exported.slides[0].elements.map(element => element.text)).toContain('审核');
    expect(exported.slides[0].elements.map(element => element.text)).not.toContain('处理');

    const deleted = await compileExample({ version: 2, slides: [{ slideKey: 'pipeline-overview', targets: [
      { kind: 'frame', editKey: 'pipeline', deleted: true },
    ] }] });
    expect(deleted.assets.size).toBe(0);
    expect(deleted.renderModel.slides[0].elements.map(node => node.authoringRef?.editKey))
      .toEqual(['headline', 'intro', 'caption']);
  });
});

function requireNode(nodes: RenderNode[], editKey: string): RenderNode {
  const node = nodes.find(candidate => candidate.authoringRef?.editKey === editKey);
  if (!node) throw new Error(`Missing example node: ${editKey}`);
  return node;
}

async function inspectExample(model: PresentationRenderModel) {
  applyTextLayoutToRenderModel(model, {
    getClusterAdvances: clusters => ({ advances: clusters.map(() => 0.08), source: 'pretext' }),
  });
  const analyzer = new SpatialAnalyzer();
  return buildToolFeedbackPayload('svg-example', 'revision-1', model, new Map(), {
    spatialAnalyzer: { analyzeSpatial: async ({ slideNodes }) => analyzer.analyze([...slideNodes]) },
  });
}
