import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { FreeformCompiler } from '../engine/FreeformCompiler';
import { DeckAssembler } from '../engine/DeckAssembler';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import { getElements, getElementByTag, directChildren } from '../engine/parser/xml/XmlNode';
import { mapChartNodeToEChartsOption } from '../../renderer/features/konvaPreview/functions/echartsMapper';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DeckSpec } from '@plugin/slides/shared';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import {
  buildDeckSpecFromDirectInput,
  CodegenPresentationService,
  compileFlexInput,
  DeckReadStateRegistry,
  initYoga,
  isFlexComposeInput,
} from '@plugin/slides/backend-codegen';
import type { DirectComposeInput } from '@plugin/slides/backend-codegen';
import {
  pptComposeProfile,
  readPptComposeRawPayload,
} from '@plugin/slides/backend-sandbox';
import { SlideMarkerIndex } from '@plugin/slides/shared';
import type {
  CodegenPresentationBuilderPort,
  PptReadOutput,
  PptWriteOutput,
} from '@plugin/slides/backend-codegen';
import type {
  PresentationDocumentRecord,
  PresentationRepositoryPort,
} from '@plugin/slides/backend-coordinator';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';

/**
 * Closed-loop smoke test for every runnable Skill example.
 *
 * For each `.js` under
 * `packages/plugins/slides/resources/skills/slides-design/references/examples/`,
 * this test:
 *
 *   1. invokes the codegen source write service and asserts the create path
 *      succeeds (no `errorCode=10` typecheck failure, no thrown error,
 *      and the builder is called with the source byte-identical to the file
 *      on disk);
 *   2. wires the in-memory repository to return that exact source as the
 *      latest version, then invokes the codegen source read service and
 *      asserts the content round-trips the source back as `cat -n`-
 *      formatted lines.
 *
 * The check is a regression net for two distinct guarantees the Skill
 * makes to the AI:
 *   - "every example .js is valid deck.js source";
 *   - "the source you submit is what read_file will expose through the
 *      shared codegen source service".
 *
 * Failure of any example here means the executable Skill contract is broken
 * and AI behavior is being silently miscalibrated.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __tests__ 迁包后位于 packages/plugins/slides/src/backend/__tests__/，上跳 6 级到 repo root。
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const EXAMPLES_DIR = path.join(
  REPO_ROOT,
  'packages/plugins/slides/resources/skills/slides-design/references/examples',
);

const EXPECTED_EXAMPLES = [
  'cover-variants',
  'media-and-paint',
  'card-grid',
  'chart-analysis',
  'chart-controls',
  'table',
  'timeline',
  'native-formula',
  'complete-deck',
] as const;

describe('slides-design runnable examples (closed loop)', () => {
  it('examples directory contains every expected .js source', () => {
    for (const stem of EXPECTED_EXAMPLES) {
      expect(
        fs.existsSync(path.join(EXAMPLES_DIR, `${stem}.js`)),
        `missing Skill example: ${stem}.js`,
      ).toBe(true);
    }
  });

  it('every example parses through SlideMarkerIndex.build with at least one createSlide()-derived slide', () => {
    for (const stem of EXPECTED_EXAMPLES) {
      const source = fs.readFileSync(path.join(EXAMPLES_DIR, `${stem}.js`), 'utf-8');
      const index = SlideMarkerIndex.build(source);
      const slides = index.listSlides();
      expect(
        slides.length,
        `example ${stem}.js parses to 0 slides; page structure and diagnostics will be broken`,
      ).toBeGreaterThanOrEqual(1);
      for (const slide of slides) {
        expect(slide.startLine).toBeGreaterThanOrEqual(1);
        expect(slide.endLine).toBeGreaterThanOrEqual(slide.startLine);
      }
    }
  });

  it('complete-deck.js executes through the real compose sandbox with four visible pages', async () => {
    const registry = new SandboxProfileRegistry();
    registry.register(pptComposeProfile);
    const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
    const source = fs.readFileSync(path.join(EXAMPLES_DIR, 'complete-deck.js'), 'utf-8');

    const result = await sandbox.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(true);
    const payload = readPptComposeRawPayload(result.value);
    expect(payload?.composeCallCount).toBe(1);
    expect(payload?.rawPayload['slides']).toHaveLength(4);
  });

  it('media-and-paint.js preserves rich text, Paint, geometry and merged TableCell semantics', async () => {
    const input = await executeAndCompileExample('media-and-paint');

    const tintedShape = input.slides[1]?.elements.find(
      (element) => element.type === 'shape'
        && element.style?.paint?.type === 'solid'
        && element.style.paint.opacity === 0.45,
    );
    expect(tintedShape?.style?.paint).toEqual({
      type: 'solid',
      color: '#B4552F',
      opacity: 0.45,
    });

    const geometryKinds = input.slides[2]?.elements
      .filter((element) => element.type === 'shape')
      .map((element) => typeof element.geometry === 'string' ? element.geometry : element.geometry?.type);
    expect(geometryKinds).toEqual(expect.arrayContaining([
      'star5',
      'preset',
      'regularPolygon',
      'trapezoid',
      'parallelogram',
      'polygon',
      'path',
    ]));

    const richText = input.slides[3]?.elements.find(
      (element) => element.type === 'text' && Array.isArray(element.content),
    );
    expect(Array.isArray(richText?.content)).toBe(true);
    if (!Array.isArray(richText?.content)) {
      throw new Error('media-and-paint rich text was not compiled as runs');
    }
    expect(richText.content[0]?.style).toMatchObject({ bold: true, color: '#141A20' });
    expect(richText.content[2]?.style).toMatchObject({ bold: true, color: '#B4552F' });

    const table = input.slides[4]?.elements.find((element) => element.type === 'table');
    expect(table?.rows?.[1]?.[0]).toMatchObject({ text: '交付', rowspan: 2 });
    expect(table?.rows?.[4]?.[0]).toMatchObject({ text: '建议', colspan: 2 });
    expect(table?.rows?.[4]?.[1]).toMatchObject({ text: '采用混合方案', colspan: 2 });

    const deckSpec = buildDeckSpecFromDirectInput(input);
    const richSlide = deckSpec.slides[3]?.spec;
    if (!richSlide || richSlide.type !== 'freeform') {
      throw new Error('media-and-paint rich-text slide did not remain freeform');
    }
    const richDeckText = richSlide.elements.find(
      (element) => element.type === 'text' && Array.isArray(element.content),
    );
    expect(richDeckText?.type).toBe('text');
    if (!richDeckText || richDeckText.type !== 'text' || !Array.isArray(richDeckText.content)) {
      throw new Error('media-and-paint rich-text runs were lost before DeckSpec');
    }
    expect(richDeckText.content[0]?.style).toMatchObject({ bold: true, color: '#141A20' });

    const tableSlide = deckSpec.slides[4]?.spec;
    if (!tableSlide || tableSlide.type !== 'structured') {
      throw new Error('media-and-paint table slide did not compile to a structured slide');
    }
    const deckTable = tableSlide.elements.find((element) => element.type === 'table');
    expect(deckTable?.type).toBe('table');
    if (!deckTable || deckTable.type !== 'table') {
      throw new Error('media-and-paint table is missing from DeckSpec');
    }
    expect(deckTable.rows[1]?.[0]).toMatchObject({ text: '交付', rowspan: 2 });
    expect(deckTable.rows[4]?.[0]).toMatchObject({ text: '建议', colspan: 2 });
  });

  it('chart-analysis.js preserves formal chart data and expands presets into DeckSpec', async () => {
    const input = await executeAndCompileExample('chart-analysis');
    const charts = input.slides[0]?.elements.filter((element) => element.type === 'chart') ?? [];

    expect(charts).toHaveLength(2);
    expect(charts[0]).toMatchObject({
      chartPreset: 'stacked-column',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      legendPosition: 'bottom',
    });
    expect(charts[0]?.series?.[0]).toMatchObject({
      name: 'Enterprise',
      values: [8, 11, 14, 21],
    });

    const deckSpec = buildDeckSpecFromDirectInput(input);
    const firstSlide = deckSpec.slides[0]?.spec;
    expect(firstSlide?.type).toBe('structured');
    if (!firstSlide || firstSlide.type !== 'structured') {
      throw new Error('chart-analysis did not compile to a structured slide');
    }
    const firstChart = firstSlide.elements.find((element) => element.type === 'chart');
    expect(firstChart?.type).toBe('chart');
    if (!firstChart || firstChart.type !== 'chart') {
      throw new Error('chart-analysis first chart is missing');
    }
    expect(firstChart.options).toMatchObject({ barGrouping: 'stacked' });
  });

  it.each(['structured', 'mixed'])('chart-controls flows through sandbox, preview and native PPTX: %s', async (mode) => {
    const input = await executeAndCompileExample('chart-controls');
    const deck = buildDeckSpecFromDirectInput(input);
    const model = new RenderModelMapper().fromGeneratedDeck('charts', 1, deck.title, deck, { width: 10, height: 5.625 });
    const nodes = model.slides.map(slide => slide.elements.find(n => n.kind === 'chart'));
    const combo = nodes[0];
    if (!combo || combo.kind !== 'chart') throw new Error('Missing combo render node');
    expect(combo).toMatchObject({ chartType: 'combo', axes: { y: { min: 0, max: 180, majorUnit: 30 }, y2: { min: 0, max: 0.3, format: '0%' } } });
    expect(mapChartNodeToEChartsOption(combo)).toMatchObject({
      yAxis: [{ min: 0, max: 180, interval: 30 }, { min: 0, max: 0.3, interval: 0.1 }],
      series: [
        { type: 'bar', data: [80, 100, { value: 128, itemStyle: { color: '#2563EB' } }, 156] },
        { type: 'line', yAxisIndex: 1, lineStyle: { width: expect.closeTo(2.5 * 96 / 72) }, label: { show: true } },
        { type: 'line', yAxisIndex: 1, symbol: 'none', lineStyle: { type: 'dashed' }, label: { show: false } },
      ],
    });
    // 真正调用 ECharts，而不只比对 option：验证标签百分比、轴单位可绘制。
    const { init } = await import('echarts');
    const previews = nodes.map(node => {
      if (!node || node.kind !== 'chart') throw new Error('Missing chart node');
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 900, height: 480 });
      try {
        chart.setOption(mapChartNodeToEChartsOption(node));
        return chart.renderToSVGString();
      } finally { chart.dispose(); }
    });
    expect(previews[0]).toContain('22%');
    expect(previews[0]).toContain('营收（亿元）');
    expect(previews[1]).toContain('100%');
    expect(previews[2]).toContain('72.0%');
    const exportDeck: DeckSpec = mode === 'mixed' ? {
      ...deck, slides: [...deck.slides, { slideNumber: 4, spec: { type: 'freeform', elements: [] } }],
    } : deck;
    const assembler = new DeckAssembler(new StructuredCompiler(), new FreeformCompiler());
    const zip = await JSZip.loadAsync(await assembler.assemble(exportDeck));
    const paths = Object.keys(zip.files).filter(p => /^ppt\/charts\/chart.*\.xml$/.test(p)).sort();
    expect(paths).toHaveLength(3);
    const xmls = await Promise.all(paths.map(p => {
      const file = zip.file(p);
      if (!file) throw new Error(`Missing chart ${p}`);
      return file.async('text');
    }));
    const doc = new DOMParser().parseFromString(xmls[0], 'application/xml');
    expect(getElements(doc, 'c:barChart')).toHaveLength(1);
    const lines = getElements(doc, 'c:lineChart');
    expect(lines).toHaveLength(1);
    expect(directChildren(lines[0], 'c:ser')).toHaveLength(2);
    const barAxis = directChildren(getElements(doc, 'c:barChart')[0], 'c:axId')[1].getAttribute('val');
    const lineAxis = directChildren(lines[0], 'c:axId')[1].getAttribute('val');
    expect(lineAxis).not.toBe(barAxis);
    expect(getElements(doc, 'c:valAx')).toHaveLength(2);
    expect(xmls[0]).toContain('formatCode="0%"');
    expect(xmls[0]).toContain('<a:ln w="31750"');
    expect(xmls[0]).toContain('<a:prstDash val="dash"');
    const highlight = getElements(doc, 'c:dPt').find(p => getElementByTag(p, 'c:idx')?.getAttribute('val') === '2');
    expect(highlight && getElementByTag(highlight, 'a:srgbClr')?.getAttribute('val')).toBe('2563EB');
    expect(xmls[1]).toContain('grouping val="percentStacked"');
    expect(xmls[2]).toContain('showPercent val="1"');
    expect(xmls[2]).toContain('showVal val="0"');
    // 原始数值缓存与可编辑工作簿必须存在，不以图片替代扩展能力。
    expect(xmls[0]).toContain('<c:v>0.22</c:v>');
    expect(Object.keys(zip.files).filter(p => p.startsWith('ppt/embeddings/') && p.endsWith('.xlsx'))).toHaveLength(3);
    const pie = new DOMParser().parseFromString(xmls[2], 'application/xml');
    for (const label of getElements(pie, 'c:dLbl')) {
      expect(getElementByTag(label, 'c:dLblPos')?.getAttribute('val')).toBe('inEnd');
      expect(getElementByTag(label, 'c:showPercent')?.getAttribute('val')).toBe('1');
      expect(getElementByTag(label, 'c:showVal')?.getAttribute('val')).toBe('0');
    }
  });

  it('keeps axis units independent and preserves source series order with selective labels', async () => {
    const input = await executeAndCompileSource(`
const s = createSlide();
s.add(createChart({ chartType: "combo", width: 8, height: 4,
  categories: ["Q1", "Q2"],
  series: [
    {name: "A", chartType: "line", values: [10, 20], color: "#112233"},
    {name: "B", chartType: "bar", values: [20, 30], color: "#223344", showDataLabels: true},
    {name: "C", chartType: "line", values: [30, 40], color: "#334455"},
    {name: "D", chartType: "line", axis: "secondary", values: [0.2, 0.4], color: "#445566"}
  ], valueAxis: {min: 10, max: 100, majorUnit: 10, numberFormat: '0"万元"', title: "左轴"},
  secondaryValueAxis: {}, showDataLabels: false, legendPosition: "none",
  chartStyle: {dataLabelFontSize: 12, dataLabelColor: "#123456"}
})); compose({title: "Axis isolation", slides: [s]});`, 'axis-isolation');
    const deck = buildDeckSpecFromDirectInput(input);
    const model = new RenderModelMapper().fromGeneratedDeck('charts', 1, deck.title, deck, { width: 10, height: 5.625 });
    const node = model.slides[0].elements.find(n => n.kind === 'chart');
    if (!node || node.kind !== 'chart') throw new Error('Missing chart');
    expect(mapChartNodeToEChartsOption(node)).toMatchObject({
      series: [{label: {show: false}}, {label: {show: true, fontSize: 16, color: '#123456'}}, {label: {show: false}}, {label: {show: false}, yAxisIndex: 1}],
      yAxis: [{min: 10, max: 100}, {min: undefined, max: undefined, name: undefined}],
      legend: {show: false},
    });
    const zip = await JSZip.loadAsync(await new StructuredCompiler().compileDeck(deck));
    const file = Object.values(zip.files).find(f => /^ppt\/charts\/chart.*\.xml$/.test(f.name));
    if (!file) throw new Error('Missing native chart');
    const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    const axes = getElements(doc, 'c:valAx');
    expect(getElements(axes[1], 'c:min')).toHaveLength(0);
    expect(getElements(axes[1], 'c:max')).toHaveLength(0);
    expect(getElements(axes[1], 'c:title')).toHaveLength(0);
    expect(getElementByTag(axes[1], 'c:numFmt')?.getAttribute('formatCode')).toBe('General');
    const series = getElements(doc, 'c:ser');
    expect(series.map(s => getElementByTag(s, 'c:order')?.getAttribute('val'))).toEqual(['0', '2', '1', '3']);
    expect(getElements(series[2], 'c:showVal').map(n => n.getAttribute('val'))).toEqual(['1']);
    expect(getElementByTag(series[2], 'a:defRPr')?.getAttribute('sz')).toBe('1200');
    const colors = series.filter(s => getElementByTag(s, 'c:marker')).map(s => {
      const marker = getElementByTag(s, 'c:marker');
      return marker ? getElementByTag(marker, 'a:srgbClr')?.getAttribute('val') : null;
    });
    expect(colors).toEqual(['112233', '334455', '445566']);
  });

  it.each([
    ['missing secondary axis', 'chartType: "combo", series: [{ name: "A", chartType: "line", axis: "secondary", values: [1, 2] }]'],
    ['wrong point count', 'series: [{ name: "A", values: [1, 2], pointColors: ["#FF0000"] }]'],
    ['mismatched data length', 'series: [{ name: "A", values: [1] }]'],
    ['invalid range', 'valueAxis: { min: 10, max: 1 }, series: [{ name: "A", values: [1, 2] }]'],
    ['percentage is not numeric formatting', 'dataLabelContent: "percentage", series: [{ name: "A", values: [1, 2] }]'],
    ['unsupported Excel format', 'valueAxis: {numberFormat: "0.0E+00"}, series: [{ name: "A", values: [1, 2] }]'],
  ])('rejects unsupported chart semantics before export: %s', async (_name, config) => {
    await expect((async () => {
      const input = await executeAndCompileSource(`const slide = createSlide(); slide.add(createChart({ chartType: "bar", categories: ["A", "B"], ${config} })); compose({title: "Rejected chart", slides: [slide]});`, 'invalid-chart');
      return buildDeckSpecFromDirectInput(input);
    })()).rejects.toThrow();
  });

  it.each([true, false])('pie series visibility overrides the opposite chart setting: %s', async (visible) => {
    const input = await executeAndCompileSource(`
const s = createSlide();
s.add(createChart({chartType: "pie", width: 8, height: 4,
  categories: ["主业", "其他"], series: [{name: "Share", values: [72, 28], color: "#112233", pointColors: [null, "#445566"], showDataLabels: ${visible}}],
  showDataLabels: ${!visible}, dataLabelContent: "percentage"
})); compose({title: "Pie labels", slides: [s]});`, 'pie-label-visibility');
    const deck = buildDeckSpecFromDirectInput(input);
    const model = new RenderModelMapper().fromGeneratedDeck('charts', 1, deck.title, deck, {width: 10, height: 5.625});
    const node = model.slides[0].elements.find(n => n.kind === 'chart');
    if (!node || node.kind !== 'chart') throw new Error('Missing chart');
    expect(mapChartNodeToEChartsOption(node)).toMatchObject({series: [{
      label: {show: visible}, data: [{itemStyle: {color: '#112233'}}, {itemStyle: {color: '#445566'}}],
    }]});
    const zip = await JSZip.loadAsync(await new StructuredCompiler().compileDeck(deck));
    const file = Object.values(zip.files).find(f => /^ppt\/charts\/chart.*\.xml$/.test(f.name));
    if (!file) throw new Error('Missing native chart');
    const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    for (const label of getElements(doc, 'c:dLbl')) {
      expect(getElementByTag(label, 'c:showPercent')?.getAttribute('val')).toBe(visible ? '1' : '0');
      expect(getElementByTag(label, 'c:showVal')?.getAttribute('val')).toBe('0');
      expect(getElementByTag(label, 'c:numFmt')?.getAttribute('formatCode')).toBe('0%');
    }
  });

  it('real compose sandbox preserves chart colors and the unified table border', async () => {
    const input = await executeAndCompileSource(`
const slide = createSlide();
slide.add(createChart({
  position: "absolute",
  x: 0.5,
  y: 0.8,
  width: 4.2,
  height: 2.4,
  categories: ["Q1", "Q2"],
  series: [{ name: "Revenue", values: [12, 18] }],
  showDataLabels: true,
  chartStyle: {
    axisLabelColor: "#475569",
    dataLabelColor: "#0F172A",
    gridlineColor: "#CBD5E1",
  },
}));
slide.add(createTable({
  position: "absolute",
  x: 5.1,
  y: 0.8,
  width: 4.2,
  height: 2.4,
  rows: [["Revenue", "18"]],
  border: { color: "#94A3B8", width: 0.75 },
}));
compose({ title: "Chart and table style", slides: [slide] });
`, 'chart-table-style');

    expect(input.slides[0]?.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'chart',
        chartStyle: {
          axisLabelColor: '#475569',
          dataLabelColor: '#0F172A',
          gridlineColor: '#CBD5E1',
        },
      }),
      expect.objectContaining({
        type: 'table',
        tableBorder: {
          width: 0.75,
          paint: { type: 'solid', color: '#94A3B8' },
        },
      }),
    ]));

    const deck = buildDeckSpecFromDirectInput(input);
    const spec = deck.slides[0]?.spec;
    if (spec?.type !== 'structured') throw new Error('expected structured slide');
    expect(spec.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'chart', chartStyle: expect.any(Object) }),
      expect.objectContaining({ type: 'table', border: expect.any(Object) }),
    ]));
  });

  it('real compose sandbox preserves PowerPoint-style text width semantics end to end', async () => {
    const input = await executeAndCompileSource(`
const slide = createSlide();

const intrinsic = createText("01");
intrinsic.position = "absolute";
intrinsic.right = 0.5;
intrinsic.top = 0.25;
intrinsic.fontSize = 10;

const constrained = createText("01");
constrained.position = "absolute";
constrained.left = 1;
constrained.top = 1;
constrained.width = 0.28;
constrained.height = 0.3;
constrained.fontSize = 10;

const manualBreak = createText("0\\n12");
manualBreak.position = "absolute";
manualBreak.left = 1;
manualBreak.top = 2;
manualBreak.fontSize = 10;

slide.add(intrinsic, constrained, manualBreak);
compose({ title: "Text width semantics", slides: [slide] });
`, 'text-width-semantics');

    const texts = input.slides[0]?.elements.filter((element) => element.type === 'text') ?? [];
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatchObject({
      content: '01',
      textWrap: 'none',
      position: { x: expect.any(Number), w: expect.any(Number) },
    });
    expect(texts[0]?.position.w).toBeGreaterThan(0.28);
    expect(texts[0]?.position.x + texts[0]?.position.w).toBeCloseTo(9.5, 5);
    expect(texts[1]).toMatchObject({
      content: '01',
      textWrap: 'word',
      position: { w: 0.28 },
    });
    expect(texts[2]).toMatchObject({ content: '0\n12', textWrap: 'none' });

    const deckSpec = buildDeckSpecFromDirectInput(input);
    const slideSpec = deckSpec.slides[0]?.spec;
    if (!slideSpec || slideSpec.type !== 'freeform') {
      throw new Error('text width semantics did not compile to a freeform slide');
    }
    expect(slideSpec.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', content: '01', textWrap: 'none' }),
      expect.objectContaining({ type: 'text', content: '01', textWrap: 'word' }),
      expect.objectContaining({ type: 'text', content: '0\n12', textWrap: 'none' }),
    ]));
  });

  for (const example of EXPECTED_EXAMPLES) {
    it(`${example}.js round-trips through codegen source write → read intact`, async () => {
      const source = fs.readFileSync(path.join(EXAMPLES_DIR, `${example}.js`), 'utf-8');
      const harness = makeHarness({ deckSource: source });

      // ── 1. codegen source write (create path) ─────────────────────
      const writeResult: PptWriteOutput = await harness.service.write(
        { source },
        {
          conversationId: 'conv-skill-example',
          projectId: 'project-skill-example',
        },
      );

      expect(writeResult.type).toBe('create');
      expect(writeResult.source).toBe(source); // byte-identical
      expect(harness.buildNewPresentation).toHaveBeenCalledTimes(1);
      expect(harness.buildNewPresentation).toHaveBeenCalledWith({
        source,
        conversationId: 'conv-skill-example',
        projectId: 'project-skill-example',
      });
      expect(harness.buildFromSource).not.toHaveBeenCalled();

      // ── 2. codegen source read (round-trip) ───────────────────────
      // The mock repo is preconfigured to return the same source as the
      // latest version, simulating a real DB read after the write.
      const readResult: PptReadOutput = await harness.service.read(
        { presentation_id: writeResult.presentationId },
        { conversationId: 'conv-skill-example' },
      );
      expect(readResult.file.presentationId).toBe('deck-new');

      // content is `cat -n` formatted; reverse that to compare.
      const observed = readResult.file.content ?? '';
      const observedLines = observed.split('\n');
      const expectedLines = source.split('\n');

      // The number of lines emitted by cat -n must equal source lines.
      // readDeckSourceSlice may trim a trailing empty line; tolerate ±1.
      expect(Math.abs(observedLines.length - expectedLines.length)).toBeLessThanOrEqual(1);

      // The first 3 lines must round-trip exactly, including the standalone
      // boundary that prevents agents from concatenating full examples.
      for (let i = 0; i < 3; i++) {
        const stripped = observedLines[i]!.replace(/^\s*\d+\t/, '');
        expect(stripped).toBe(expectedLines[i]);
      }

      // The compose() line must appear in observation (deck script invariant).
      expect(observed).toMatch(/compose\(\{/);
    });
  }
});

async function executeAndCompileExample(stem: string): Promise<DirectComposeInput> {
  const source = fs.readFileSync(path.join(EXAMPLES_DIR, `${stem}.js`), 'utf-8');
  return executeAndCompileSource(source, `${stem}.js`);
}

async function executeAndCompileSource(
  source: string,
  sourceLabel: string,
): Promise<DirectComposeInput> {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
  const result = await sandbox.execute({
    profileId: 'ppt_compose',
    language: 'javascript',
    source,
    inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
  });
  if (!result.success) {
    throw new Error(`${sourceLabel} sandbox execution failed: ${result.error.message}`);
  }

  const payload = readPptComposeRawPayload(result.value);
  if (!payload || !isFlexComposeInput(payload.rawPayload)) {
    throw new Error(`${sourceLabel} did not produce a FlexComposeInput payload`);
  }

  await initYoga();
  const compiled = compileFlexInput(payload.rawPayload);
  if (!compiled.input) {
    throw new Error(`${sourceLabel} Flex compilation failed: ${compiled.error ?? 'unknown error'}`);
  }
  return compiled.input;
}

// ─── harness ─────────────────────────────────────────────────────────────

interface ExampleHarness {
  service: CodegenPresentationService;
  buildFromSource: ReturnType<typeof vi.fn<CodegenPresentationBuilderPort['buildFromSource']>>;
  buildNewPresentation: ReturnType<typeof vi.fn<CodegenPresentationBuilderPort['buildNewPresentation']>>;
}

function makeHarness({ deckSource }: { deckSource: string }): ExampleHarness {
  const deckSpec: DeckSpec = {
    title: 'Skill Example Smoke Deck',
    layout: '16x9',
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [
            {
              type: 'text',
              content: 'Skill example smoke',
              position: { x: 0, y: 0, w: 1, h: 1 },
            },
          ],
        },
      },
    ],
  };

  const document: PresentationDocumentRecord = {
    nodeId: 'deck-1',
    currentRevisionId: 'version-1',
    currentRevision: 1,
    deckSpec,
    deckSource,
    sourceHash: 'source-hash-1',
    pptxBuffer: Buffer.from('pptx'),
    title: 'Skill Example Smoke Deck',
    slideCount: 1,
    layout: '16x9',
    createdAt: 1,
    updatedAt: 1,
  };

  const presentationRepo: Pick<PresentationRepositoryPort, 'getPresentation'> = {
    getPresentation: vi.fn(async (_nodeId: string) => document),
  };

  const buildFromSource = vi.fn(async (_input: { nodeId: string; source: string }) => ({
    versionId: 'version-2',
    deckSpec,
    pptxBuffer: Buffer.from('pptx'),
    diagnostics: [],
    parseWarnings: [],
  }));
  const buildNewPresentation = vi.fn(async (_input: { source: string; projectId: string }) => ({
    nodeId: 'deck-new',
    versionId: 'version-new',
    deckSpec,
    pptxBuffer: Buffer.from('pptx'),
    diagnostics: [],
    parseWarnings: [],
  }));

  const builder: CodegenPresentationBuilderPort = {
    buildFromSource,
    buildNewPresentation,
  };

  const service = new CodegenPresentationService({
    presentationRepo,
    builder,
    readStateRegistry: new DeckReadStateRegistry(),
    buildExecution: createInProcessPresentationBuildExecution(),
  });

  return {
    service,
    buildFromSource,
    buildNewPresentation,
  };
}
