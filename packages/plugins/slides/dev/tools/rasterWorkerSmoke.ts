import { assertChartPlotBackgrounds, assertGeneratedChartRenders, GENERATED_CHART_RASTER_SOURCE } from './rasterChartFidelity';
import { assertIntrinsicTextFidelity } from './intrinsicTextFidelity';
import { materializeIntrinsicTextBoxes } from '../../src/backend/engine/text/materializeIntrinsicTextBoxes';
import { assertGradientFidelityRenders } from './rasterGradientFidelity';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import sharp from 'sharp';
import { SandboxProfileRegistry } from '../../../../../src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from '../../../../../src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from '../../../../../src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { createSlidesRasterWorkerDefinition } from '../../src/backend/features/slideRasterWorker/infrastructure/createSlidesRasterWorkerDefinition';
import { PresentationScreenshotRuntime } from '../../src/backend/features/presentationScreenshot/orchestration/PresentationScreenshotRuntime';
import { createPresentationSvgGraphicFallbackRasterizer } from '../../src/backend/features/presentationSvgGraphicFallback';
import { RenderModelMapper } from '../../src/backend/engine/parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../../src/backend/engine/text/renderModelTextLayout';
import { pptComposeProfile, readPptComposeRawPayload } from '../../src/backend/sandbox/pptComposeProfile';
import {
  buildDeckSpecFromDirectInput,
} from '../../src/backend/codegen/compose/presentationComposeInput';
import {
  compileFlexInput,
  initYoga,
  isFlexComposeInput,
} from '../../src/backend/codegen/compose/flex-layout';
import { resolveSlideSizeInches } from '../../src/shared';
import {
  parseSlideRasterResult,
  type SlideRasterRequest,
} from '../../src/shared/slideRasterization';
import {
  invokeHiddenWorker,
  registerHiddenWorker,
} from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { clearHiddenWorkersForTests } from '../../../../../src/electron-main/hidden-worker/hiddenWorkerRuntime';
import { createSystemFontResolutionRuntime } from '@plugin/backend/fontResolution';
import {
  TEXT_CLIPPING_AUDIT_CASES,
  createTextClippingAuditDeckSource,
} from '../fixtures/textClippingAuditFixture';

const request: SlideRasterRequest = {
  requestId: 'slides-raster-electron-smoke',
  slide: {
    slideId: 'smoke-slide',
    index: 0,
    layoutKey: 'blank',
    background: {
      paint: {
        type: 'linear',
        angle: 30,
        stops: [
          { color: '#1E3A8A', position: 0 },
          { color: '#60A5FA', position: 1 },
        ],
      },
    },
    elements: [
      {
        id: 'radial-fill',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0.1, y: 0.1, w: 0.35, h: 0.35, unit: 'in' },
        zIndex: 1,
        fill: {
          type: 'radial',
          stops: [
            { color: '#FFFFFF', position: 0 },
            { color: '#F97316', position: 1 },
          ],
        },
      },
      {
        id: 'linear-stroke',
        kind: 'shape',
        geometry: { type: 'preset', name: 'line' },
        box: { x: 0.1, y: 0.7, w: 0.8, h: 0.1, unit: 'in' },
        zIndex: 2,
        fill: { type: 'none' },
        stroke: {
          width: 2,
          paint: {
            type: 'linear',
            angle: 0,
            stops: [
              { color: '#22C55E', position: 0 },
              { color: '#FACC15', position: 1 },
            ],
          },
        },
      },
    ],
  },
  slideSize: { width: 1, height: 1, unit: 'in' },
  profile: {
    id: 'slides-raster-electron-smoke-v1',
    viewportWidthPx: 2,
    viewportHeightPx: 2,
    pixelRatio: 1,
    format: 'png',
  },
};

async function run(): Promise<void> {
  await app.whenReady();
  const requestedPackageRoot = process.argv[2];
  const packageRoot = requestedPackageRoot
    ? path.resolve(requestedPackageRoot)
    : path.resolve(__dirname, '../..');
  await registerHiddenWorker(createSlidesRasterWorkerDefinition({
    runtime: {
      mode: requestedPackageRoot ? 'artifact-runtime' : 'source-development',
      packageRoot,
      rootSource: requestedPackageRoot ? 'explicit' : 'workspace',
    },
  }));

  try {
    const smokeCases: readonly { label: string; rasterRequest: SlideRasterRequest }[] = [
      {
        label: 'linear background',
        rasterRequest: {
          ...request,
          requestId: 'slides-raster-linear-background-smoke',
          slide: { ...request.slide, elements: [] },
        },
      },
      {
        label: 'radial shape fill',
        rasterRequest: {
          ...request,
          requestId: 'slides-raster-radial-fill-smoke',
          slide: {
            ...request.slide,
            elements: request.slide.elements.filter((element) => element.id === 'radial-fill'),
          },
        },
      },
      {
        label: 'linear line stroke',
        rasterRequest: {
          ...request,
          requestId: 'slides-raster-linear-stroke-smoke',
          slide: {
            ...request.slide,
            elements: request.slide.elements.filter((element) => element.id === 'linear-stroke'),
          },
        },
      },
      { label: 'combined Paint page', rasterRequest: request },
    ];

    for (const smokeCase of smokeCases) {
      const result = parseSlideRasterResult(
        await invokeHiddenWorker('slides-raster', smokeCase.rasterRequest),
      );
      if (result.status === 'failure') {
        throw new Error(`${smokeCase.label}: ${result.error.code}: ${result.error.message}`);
      }
      if (result.widthPx !== 2 || result.heightPx !== 2 || !hasPngSignature(result.bytes)) {
        throw new Error(`${smokeCase.label}: Slides raster worker returned an invalid PNG`);
      }
      console.log(`${smokeCase.label} passed: ${result.widthPx}x${result.heightPx}, ${result.bytes.byteLength} bytes`);
    }

    await assertGradientFidelityRenders(request);
    await assertSvgGraphicFallbackRenders();
    await assertTransparentChartRenders();
    await assertGeneratedChartRenders(await compileDeckSourceToRenderModel(
      GENERATED_CHART_RASTER_SOURCE,
      'generated-chart-raster-contract',
    ));

    await assertDeckSourceShapeGeometryRenders();
    await assertSystemFontDecksRender();

    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-screenshot-smoke-'));
    try {
      const screenshotRuntime = new PresentationScreenshotRuntime({
        loadSource: async () => ({
          identity: {
            presentationId: 'smoke-deck',
            title: 'Smoke Deck',
            versionId: 'smoke-version-1',
            versionNumber: 1,
            sourceKind: 'generated',
          },
          renderModel: {
            presentationId: 'smoke-deck',
            title: 'Smoke Deck',
            version: 1,
            sourceKind: 'generated',
            slideSize: { width: 1, height: 1, unit: 'in' },
            slides: [request.slide],
            capabilities: {
              hasSemanticRender: true,
              hasReferencePreview: false,
              hasHitTest: true,
              hasSelection: true,
            },
          },
        }),
      });
      const screenshot = await screenshotRuntime.render({
        presentationId: 'smoke-deck',
        selection: { kind: 'all' },
        profile: {
          id: 'slides-screenshot-electron-smoke-v1',
          viewportWidthPx: 2,
          pixelRatio: 1,
        },
        encoding: { kind: 'agent_review_jpeg' },
        output: { kind: 'directory', root: outputRoot, overwrite: false },
      });
      if (screenshot.slides.length !== 1) {
        throw new Error('Slides screenshot orchestration returned an incomplete batch');
      }
      const outputBytes = await fs.readFile(path.join(outputRoot, 'slide-001.jpg'));
      const outputMetadata = await sharp(outputBytes).metadata();
      if (outputMetadata.format !== 'jpeg' || outputMetadata.hasAlpha === true) {
        throw new Error('Slides screenshot orchestration published an invalid JPEG');
      }
      console.log(
        `slides screenshot orchestration smoke passed: ${screenshot.slides.length} page(s)`,
      );
    } finally {
      await fs.rm(outputRoot, { recursive: true, force: true });
    }
  } finally {
    await clearHiddenWorkersForTests();
  }
}

async function assertTransparentChartRenders(): Promise<void> {
  const chartRequest: SlideRasterRequest = {
    requestId: 'slides-chart-transparent-export-smoke',
    slide: {
      slideId: 'chart-export-slide',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'none' } },
      elements: [{
        id: 'chart-export',
        kind: 'chart',
        box: { x: 0, y: 0, w: 6, h: 3, unit: 'in' },
        zIndex: 0,
        chartType: 'column',
        categories: ['Q1', 'Q2', 'Q3'],
        series: [{ name: '收入', values: [12, 20, 16] }],
        palette: ['#2563EB'],
      }],
    },
    slideSize: { width: 6, height: 3, unit: 'in' },
    profile: {
      id: 'slides-chart-transparent-export-smoke-v1',
      viewportWidthPx: 576,
      viewportHeightPx: 288,
      pixelRatio: 2,
      format: 'png',
      transparentBackground: true,
    },
  };
  const raster = parseSlideRasterResult(
    await invokeHiddenWorker('slides-raster', chartRequest),
  );
  if (raster.status === 'failure') {
    throw new Error(`chart raster failed: ${raster.error.code}: ${raster.error.message}`);
  }
  const decoded = await sharp(raster.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 1152 || decoded.info.height !== 576) {
    throw new Error('Chart export raster returned unexpected dimensions');
  }
  const cornerAlpha = decoded.data[3];
  let opaquePixels = 0;
  for (let index = 3; index < decoded.data.length; index += decoded.info.channels) {
    if (decoded.data[index] > 0) opaquePixels += 1;
  }
  if (cornerAlpha !== 0 || opaquePixels < 1000) {
    throw new Error(
      `Chart export raster lost transparency or chart content: corner=${cornerAlpha}, opaque=${opaquePixels}`,
    );
  }
  console.log(`transparent ECharts export passed: ${raster.widthPx}x${raster.heightPx}`);
  await assertChartPlotBackgrounds(chartRequest);
}

async function assertSvgGraphicFallbackRenders(): Promise<void> {
  const canonicalSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><circle cx="50" cy="25" r="18" fill="#2563EB"/></svg>';
  const raster = await createPresentationSvgGraphicFallbackRasterizer().rasterizeSvgGraphic({
    canonicalSvg,
    contentHash: createHash('sha256').update(canonicalSvg).digest('hex'),
    viewBox: { width: 100, height: 50 },
  });
  if (raster.widthPx !== 1920 || raster.heightPx !== 960 || !hasPngSignature(raster.pngBytes)) {
    throw new Error('SVG Graphic fallback returned invalid dimensions or PNG bytes');
  }
  const decoded = await sharp(raster.pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cornerAlpha = decoded.data[3];
  const centerIndex = (
    Math.floor(decoded.info.height / 2) * decoded.info.width
    + Math.floor(decoded.info.width / 2)
  ) * decoded.info.channels;
  const centerAlpha = decoded.data[centerIndex + 3];
  if (cornerAlpha !== 0 || centerAlpha !== 255) {
    throw new Error(`SVG Graphic fallback lost transparency: corner=${cornerAlpha}, center=${centerAlpha}`);
  }
  console.log(`SVG Graphic transparent fallback passed: ${raster.widthPx}x${raster.heightPx}`);
}

const SHAPE_GEOMETRY_DECK_SOURCE = `
const slide = createSlide({ background: { color: '#FFFFFF' } });

const triangle = createShape({ geometry: 'triangle', position: 'absolute', x: 0.5, y: 0.5, width: 2, height: 1.5, fill: '#DC2626' });
const pentagon = createShape({ geometry: { type: 'regularPolygon', sides: 5 }, position: 'absolute', x: 3, y: 0.5, width: 2, height: 1.5, fill: '#2563EB' });
const trapezoid = createShape({ geometry: { type: 'trapezoid', topLeftInset: 0, topRightInset: 0.3 }, position: 'absolute', x: 5.5, y: 0.5, width: 2, height: 1.5, fill: '#16A34A' });
const parallelogram = createShape({ geometry: { type: 'parallelogram', slant: 0.25, direction: 'right' }, position: 'absolute', x: 8, y: 0.5, width: 2, height: 1.5, fill: '#9333EA' });
const polygon = createShape({ geometry: { type: 'polygon', points: [{ x: 0, y: 0.2 }, { x: 0.75, y: 0 }, { x: 1, y: 0.8 }, { x: 0.3, y: 1 }] }, position: 'absolute', x: 1.75, y: 3, width: 2.5, height: 1.5, fill: '#EA580C' });
const curved = createShape({ geometry: { type: 'path', viewBox: { width: 100, height: 100 }, commands: [{ type: 'moveTo', x: 0, y: 80 }, { type: 'cubicTo', x1: 20, y1: 0, x2: 80, y2: 0, x: 100, y: 80 }, { type: 'lineTo', x: 50, y: 100 }, { type: 'close' }] }, position: 'absolute', x: 5.75, y: 3, width: 2.5, height: 1.5, fill: '#0891B2' });

slide.add(triangle, pentagon, trapezoid, parallelogram, polygon, curved);
compose({ title: 'Shape Geometry E2E', layout: '16x9', slides: [slide] });
`;

async function assertDeckSourceShapeGeometryRenders(): Promise<void> {
  const renderModel = await compileDeckSourceToRenderModel(
    SHAPE_GEOMETRY_DECK_SOURCE,
    'shape-geometry-e2e',
  );
  const rasterRequest: SlideRasterRequest = {
    requestId: 'slides-shape-geometry-deck-source-e2e',
    slide: renderModel.slides[0],
    slideSize: renderModel.slideSize,
    profile: {
      id: 'slides-shape-geometry-e2e-v1',
      viewportWidthPx: 960,
      viewportHeightPx: 540,
      pixelRatio: 1,
      format: 'png',
    },
  };
  const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', rasterRequest));
  if (raster.status === 'failure') {
    throw new Error(`shape raster failed: ${raster.error.code}: ${raster.error.message}`);
  }
  await assertShapePixels(raster.bytes, raster.widthPx, raster.heightPx);
  console.log(`deck.js -> compose -> RenderModel -> PNG shape geometry passed: ${raster.widthPx}x${raster.heightPx}`);
}

async function compileDeckSourceToRenderModel(source: string, presentationId: string) {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
  const execution = await sandbox.execute({
    profileId: 'ppt_compose',
    language: 'javascript',
    source,
    profileMode: 'codegen-source',
    capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
  });
  if (!execution.success) {
    throw new Error(`deck.js sandbox failed: ${execution.error?.message ?? 'unknown error'}`);
  }
  const composePayload = readPptComposeRawPayload(execution.value);
  if (!composePayload || !isFlexComposeInput(composePayload.rawPayload)) {
    throw new Error('deck.js did not produce a Flex compose payload');
  }
  await initYoga();
  const compiled = compileFlexInput(composePayload.rawPayload);
  if (!compiled.input || compiled.error) {
    throw new Error(`Flex compose failed: ${compiled.error ?? 'missing input'}`);
  }
  const deckSpec = buildDeckSpecFromDirectInput(compiled.input);
  await materializeIntrinsicTextBoxes(deckSpec);
  const slideSize = resolveSlideSizeInches(deckSpec.layout);
  const renderModel = new RenderModelMapper().fromGeneratedDeck(
    presentationId,
    1,
    deckSpec.title,
    deckSpec,
    slideSize,
  );
  await prewarmTextLayoutForRenderModel(renderModel);
  return applyTextLayoutToRenderModel(renderModel);
}

async function assertSystemFontDecksRender(): Promise<void> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-font-smoke-'));
  const fontRuntime = createSystemFontResolutionRuntime({ runtimeDataDirectory: runtimeRoot });
  try {
    await fontRuntime.initialize();
    const [latin, eastAsian] = await Promise.all([
      fontRuntime.listFontFamilies({ script: 'latin', offset: 0, limit: 30 }),
      fontRuntime.listFontFamilies({ script: 'eastAsian', offset: 0, limit: 30 }),
    ]);
    const cases = [
      {
        script: 'latin',
        family: requireFontFamily(
          latin.families.find((candidate) => (
            candidate.styles.includes('regular') && candidate.styles.includes('bold')
          ))?.family,
          'latin regular+bold',
        ),
        text: 'Runtime-selected typography keeps English slides readable.',
      },
      {
        script: 'eastAsian',
        family: requireFontFamily(
          eastAsian.families.find((candidate) => (
            candidate.styles.includes('regular') && candidate.styles.includes('bold')
          ))?.family,
          'eastAsian regular+bold',
        ),
        text: '运行时选择字体后，中文换行与页面布局仍应清晰稳定。',
      },
    ] as const;

    for (const fontCase of cases) {
      const renderModel = await compileDeckSourceToRenderModel(
        createFontSmokeDeckSource(fontCase.family, fontCase.text),
        `system-font-${fontCase.script}-e2e`,
      );
      const firstText = renderModel.slides[0]?.elements.find((element) => element.kind === 'text');
      const firstRun = firstText?.kind === 'text' ? firstText.paragraphs[0]?.runs[0] : undefined;
      if (firstRun?.fontFamily !== fontCase.family) {
        throw new Error(`${fontCase.script} theme font was not preserved in RenderModel`);
      }

      const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
        requestId: `slides-system-font-${fontCase.script}-e2e`,
        slide: renderModel.slides[0],
        slideSize: renderModel.slideSize,
        profile: {
          id: `slides-system-font-${fontCase.script}-e2e-v1`,
          viewportWidthPx: 960,
          viewportHeightPx: 540,
          pixelRatio: 1,
          format: 'png',
        },
      }));
      if (raster.status === 'failure') {
        throw new Error(`${fontCase.script} font raster failed: ${raster.error.code}: ${raster.error.message}`);
      }
      await assertTextPixels(raster.bytes, raster.widthPx, raster.heightPx, fontCase.script);
      console.log(`system ${fontCase.script} font passed: ${fontCase.family}, ${raster.widthPx}x${raster.heightPx}`);
    }
    const clippingFontFamily = latin.families.find((candidate) => (
      candidate.family === 'Avenir Next' && candidate.styles.includes('bold')
    ))?.family ?? cases[0].family;
    await assertTextClippingAuditRenders(clippingFontFamily);
    await assertIntrinsicTextFidelity(clippingFontFamily, compileDeckSourceToRenderModel);
  } finally {
    fontRuntime.dispose();
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
}

async function assertTextClippingAuditRenders(fontFamily: string): Promise<void> {
  const renderModel = await compileDeckSourceToRenderModel(
    createTextClippingAuditDeckSource(fontFamily),
    'text-clipping-audit-e2e',
  );

  for (const [index, testCase] of TEXT_CLIPPING_AUDIT_CASES.entries()) {
    const slide = renderModel.slides[index];
    const fullTextNode = slide?.elements[0];
    const prefixTextNode = slide?.elements[1];
    if (fullTextNode?.kind !== 'text' || prefixTextNode?.kind !== 'text') {
      throw new Error(`${testCase.id}: text clipping fixture lost its two text nodes`);
    }
    const fullRun = fullTextNode.paragraphs[0]?.runs[0];
    if (
      fullRun?.text !== testCase.text
      || fullRun.text.includes('\u00A0')
      || fullRun.fontFamily !== fontFamily
      || fullRun.letterSpacing !== testCase.letterSpacingPt
    ) {
      throw new Error(`${testCase.id}: text clipping fixture semantics drifted before rasterization`);
    }

    const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
      requestId: `slides-text-clipping-${testCase.id}-e2e`,
      slide,
      slideSize: renderModel.slideSize,
      profile: {
        id: `slides-text-clipping-${testCase.id}-e2e-v1`,
        viewportWidthPx: 1600,
        viewportHeightPx: 900,
        pixelRatio: 1,
        format: 'png',
      },
    }));
    if (raster.status === 'failure') {
      throw new Error(`${testCase.id}: text clipping raster failed: ${raster.error.code}: ${raster.error.message}`);
    }
    await assertFinalGlyphExtendsPastPrefix(
      raster.bytes,
      raster.widthPx,
      raster.heightPx,
      testCase,
    );
    console.log(`${testCase.id} final glyph passed without NBSP: ${fontFamily}`);
  }
}

function requireFontFamily(family: string | undefined, script: string): string {
  if (family === undefined) {
    throw new Error(`System font catalog returned no ${script} candidates`);
  }
  return family;
}

function createFontSmokeDeckSource(fontFamily: string, text: string): string {
  return `
const slide = createSlide({ background: { color: '#FFFFFF' } });
const title = createText(${JSON.stringify(text)});
title.position = 'absolute';
title.x = 0.8; title.y = 1.5; title.width = 8.4; title.height = 1.6;
title.fontSize = 28; title.fontWeight = 'bold'; title.color = '#111827';
slide.add(title);
compose({
  title: 'System Font E2E',
  layout: '16x9',
  theme: { fonts: { major: ${JSON.stringify(fontFamily)}, minor: ${JSON.stringify(fontFamily)} } },
  slides: [slide],
});
`;
}

async function assertShapePixels(bytes: Uint8Array, width: number, height: number): Promise<void> {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height) {
    throw new Error('shape raster decoded dimensions do not match worker result');
  }
  const scale = width / 10;
  const coloredCenters: ReadonlyArray<readonly [number, number, string]> = [
    [1.5, 1.25, 'triangle'],
    [4, 1.25, 'pentagon'],
    [6.5, 1.25, 'trapezoid'],
    [9, 1.25, 'parallelogram'],
    [3, 3.75, 'polygon'],
    [7, 3.8, 'curved path'],
  ];
  for (const [x, y, label] of coloredCenters) {
    if (isNearWhite(readPixel(decoded.data, decoded.info.channels, width, x * scale, y * scale))) {
      throw new Error(`${label} center was not rendered`);
    }
  }
  const whiteCorners: ReadonlyArray<readonly [number, number, string]> = [
    [0.55, 0.55, 'triangle'],
    [3.05, 0.55, 'pentagon'],
    [7.45, 0.55, 'right trapezoid'],
    [8.05, 0.55, 'parallelogram'],
    [4.2, 3.05, 'polygon'],
    [5.8, 3.05, 'curved path'],
  ];
  for (const [x, y, label] of whiteCorners) {
    if (!isNearWhite(readPixel(decoded.data, decoded.info.channels, width, x * scale, y * scale))) {
      throw new Error(`${label} corner is filled like a rectangle; geometry was not applied`);
    }
  }
}

async function assertTextPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  script: string,
): Promise<void> {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height) {
    throw new Error(`${script} font raster decoded dimensions do not match worker result`);
  }
  const startX = Math.floor(width * 0.08);
  const endX = Math.ceil(width * 0.92);
  const startY = Math.floor(height * 0.25);
  const endY = Math.ceil(height * 0.65);
  let darkPixelCount = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const [red, green, blue] = readPixel(decoded.data, decoded.info.channels, width, x, y);
      if (red < 220 || green < 220 || blue < 220) darkPixelCount += 1;
    }
  }
  if (darkPixelCount < 100) {
    throw new Error(`${script} system-font text was not visibly rasterized`);
  }
}

async function assertFinalGlyphExtendsPastPrefix(
  bytes: Uint8Array,
  width: number,
  height: number,
  testCase: (typeof TEXT_CLIPPING_AUDIT_CASES)[number],
): Promise<void> {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height) {
    throw new Error(`${testCase.id}: decoded dimensions do not match worker result`);
  }
  const scale = width / 10;
  const fullBounds = findDarkPixelBounds(
    decoded.data,
    decoded.info.channels,
    width,
    height,
    toPixelSearchBox(testCase.box, scale),
  );
  const prefixBounds = findDarkPixelBounds(
    decoded.data,
    decoded.info.channels,
    width,
    height,
    toPixelSearchBox({ ...testCase.box, y: testCase.box.y + 0.5 }, scale),
  );
  if (fullBounds == null || prefixBounds == null) {
    throw new Error(`${testCase.id}: full text or prefix text was not visibly rasterized`);
  }
  if (fullBounds.right - prefixBounds.right < 2) {
    throw new Error(
      `${testCase.id}: final glyph did not extend past prefix; fullRight=${fullBounds.right}, prefixRight=${prefixBounds.right}`,
    );
  }
}

interface PixelSearchBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface DarkPixelBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function toPixelSearchBox(
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  scale: number,
): PixelSearchBox {
  return {
    left: Math.floor(box.x * scale),
    top: Math.floor(box.y * scale),
    right: Math.ceil((box.x + box.w) * scale),
    bottom: Math.ceil((box.y + box.h) * scale),
  };
}

function findDarkPixelBounds(
  bytes: Buffer,
  channels: number,
  width: number,
  height: number,
  search: PixelSearchBox,
): DarkPixelBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = Math.max(search.top, 0); y < Math.min(search.bottom, height); y += 1) {
    for (let x = Math.max(search.left, 0); x < Math.min(search.right, width); x += 1) {
      const [red, green, blue] = readPixel(bytes, channels, width, x, y);
      if (red >= 220 && green >= 220 && blue >= 220) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

function readPixel(
  bytes: Buffer,
  channels: number,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number] {
  const index = (Math.round(y) * width + Math.round(x)) * channels;
  return [bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0];
}

function isNearWhite([red, green, blue]: readonly [number, number, number]): boolean {
  return red > 245 && green > 245 && blue > 245;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
    && bytes[4] === 0x0D
    && bytes[5] === 0x0A
    && bytes[6] === 0x1A
    && bytes[7] === 0x0A;
}

void run().then(
  () => {
    app.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  },
);
