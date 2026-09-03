import { app, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import {
  SVG_PHASE_0_INVALID_FIXTURES,
  SVG_PHASE_0_VALID_FIXTURES,
} from '../fixtures/svgPhase0Fixtures';
import {
  SVG_PHASE_0_PROTOTYPE_POLICY,
  SvgPhase0AdmissionError,
  admitSvgPhase0,
  measureSvgSource,
  type SvgPhase0AdmissionReport,
  type SvgPhase0Metrics,
} from './svgPhase0AdmissionPrototype';

interface ParsedArguments {
  readonly outputRoot?: string;
  readonly corpusRoot?: string;
}

interface BrowserRasterResult {
  readonly pngBase64: string;
  readonly width: number;
  readonly height: number;
}

interface PixelComparison {
  readonly background: string;
  readonly meanAbsoluteError: number;
  readonly maxChannelError: number;
  readonly differentPixelRate: number;
}

interface RendererFixtureResult {
  readonly fixtureId: string;
  readonly contentHash: string;
  readonly browserPngHash: string;
  readonly sharpPngHash: string;
  readonly browserBytes: number;
  readonly sharpBytes: number;
  readonly comparisons: readonly PixelComparison[];
}

interface SvgPictureBinding {
  readonly slideIndex: number;
  readonly objectName: string;
  readonly fallbackRelationshipId: string;
  readonly svgRelationshipId: string;
  readonly fallbackPartPath: string;
  readonly svgPartPath: string;
}

interface CorpusSummary {
  readonly root: string;
  readonly fileCount: number;
  readonly parseFailureCount: number;
  readonly admittedCount: number;
  readonly rejectedCountByCode: Readonly<Record<string, number>>;
  readonly metrics: Readonly<Record<keyof Omit<SvgPhase0Metrics, 'elementNames'>, Distribution>>;
  readonly admittedMetrics: Readonly<
    Record<keyof Omit<SvgPhase0Metrics, 'elementNames'>, Distribution>
  >;
  readonly frequentElements: readonly { readonly name: string; readonly count: number }[];
}

interface Distribution {
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

const BROKEN_FALLBACK_HASH = '0db2447fffb75ae48f57c711c26783f619591d48b1713f997a7bc34626c95ff1';
const RASTER_WIDTH = 1_280;
const RASTER_HEIGHT = 720;

async function run(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const outputRoot = args.outputRoot
    ? path.resolve(args.outputRoot)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-slides-svg-phase0-'));
  await fs.mkdir(outputRoot, { recursive: true });

  const admissions = validateAdmissionFixtures();
  validateResourceBudgets();
  await app.whenReady();
  const browserWindow = await createRasterWindow();

  try {
    const rendererResults: RendererFixtureResult[] = [];
    const browserFallbacks = new Map<string, Buffer>();
    for (const fixture of SVG_PHASE_0_VALID_FIXTURES) {
      const admission = admissions.get(fixture.id);
      if (!admission) throw new Error(`缺少 ${fixture.id} admission report。`);
      const canonicalPath = path.join(outputRoot, `${fixture.id}.canonical.svg`);
      await fs.writeFile(canonicalPath, admission.canonicalSvg, 'utf8');

      const browserPng = await rasterizeInChromium(
        browserWindow,
        admission.canonicalSvg,
        RASTER_WIDTH,
        RASTER_HEIGHT
      );
      const sharpPng = await rasterizeWithSharp(
        admission.canonicalSvg,
        RASTER_WIDTH,
        RASTER_HEIGHT
      );
      assertPng(browserPng, `${fixture.id} Chromium`);
      assertPng(sharpPng, `${fixture.id} Sharp`);
      browserFallbacks.set(fixture.id, browserPng);
      await Promise.all([
        fs.writeFile(path.join(outputRoot, `${fixture.id}.chromium.png`), browserPng),
        fs.writeFile(path.join(outputRoot, `${fixture.id}.sharp.png`), sharpPng),
      ]);

      rendererResults.push({
        fixtureId: fixture.id,
        contentHash: admission.contentHash,
        browserPngHash: sha256(browserPng),
        sharpPngHash: sha256(sharpPng),
        browserBytes: browserPng.length,
        sharpBytes: sharpPng.length,
        comparisons: await Promise.all([
          comparePngs(browserPng, sharpPng, '#FFFFFF'),
          comparePngs(browserPng, sharpPng, '#0F172A'),
        ]),
      });
    }

    const rawPptx = await createSvgPptx(admissions);
    const rawPptxPath = path.join(outputRoot, 'svg-phase0-broken-fallback.pptx');
    await fs.writeFile(rawPptxPath, rawPptx);
    const rawAudit = await auditPptx(rawPptx, admissions, true);

    const fixedPptx = await replaceSvgFallbacks(rawPptx, browserFallbacks);
    const fixedPptxPath = path.join(outputRoot, 'svg-phase0-real-fallback.pptx');
    await fs.writeFile(fixedPptxPath, fixedPptx);
    const fixedAudit = await auditPptx(fixedPptx, admissions, false);

    const corpus = args.corpusRoot ? await measureCorpus(path.resolve(args.corpusRoot)) : undefined;
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      outputRoot,
      policy: SVG_PHASE_0_PROTOTYPE_POLICY,
      admission: {
        validFixtures: [...admissions.entries()].map(([fixtureId, admission]) => ({
          fixtureId,
          contentHash: admission.contentHash,
          viewBox: admission.viewBox,
          metrics: admission.metrics,
          facts: admission.facts,
        })),
        invalidFixtures: SVG_PHASE_0_INVALID_FIXTURES.map(fixture => ({
          fixtureId: fixture.id,
          expectedCode: fixture.expectedCode,
        })),
        budgetChecks: [
          'maxBytes',
          'maxDepth',
          'maxElements',
          'maxAttributes',
          'maxPathSegments',
          'maxTextLength',
        ],
      },
      rendererResults,
      pptx: {
        rawPath: rawPptxPath,
        fixedPath: fixedPptxPath,
        rawAudit,
        fixedAudit,
      },
      corpus,
    };
    const reportPath = path.join(outputRoot, 'svg-phase0-validation-report.json');
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`SVG Phase 0 validation passed: ${reportPath}`);
    console.log(`PowerPoint manual fixture: ${fixedPptxPath}`);
  } finally {
    browserWindow.destroy();
    app.quit();
  }
}

function validateAdmissionFixtures(): Map<string, SvgPhase0AdmissionReport> {
  const reports = new Map<string, SvgPhase0AdmissionReport>();
  for (const fixture of SVG_PHASE_0_VALID_FIXTURES) {
    const first = admitSvgPhase0(fixture.source);
    const second = admitSvgPhase0(first.canonicalSvg);
    if (first.canonicalSvg !== second.canonicalSvg || first.contentHash !== second.contentHash) {
      throw new Error(`${fixture.id}: canonicalization 不是幂等的。`);
    }
    reports.set(fixture.id, first);
  }

  for (const fixture of SVG_PHASE_0_INVALID_FIXTURES) {
    try {
      admitSvgPhase0(fixture.source);
      throw new Error(`${fixture.id}: 恶意/不支持样本被错误接受。`);
    } catch (error) {
      if (!(error instanceof SvgPhase0AdmissionError)) throw error;
      if (error.code !== fixture.expectedCode) {
        throw new Error(
          `${fixture.id}: 期望 ${fixture.expectedCode}，实际 ${error.code}: ${error.message}`
        );
      }
    }
  }
  return reports;
}

function validateResourceBudgets(): void {
  const fixture = SVG_PHASE_0_VALID_FIXTURES[0];
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxBytes: 1 }),
    'slides.svg.resource_limit_exceeded'
  );
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxDepth: 1 }),
    'slides.svg.resource_limit_exceeded'
  );
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxElements: 2 }),
    'slides.svg.resource_limit_exceeded'
  );
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxAttributes: 2 }),
    'slides.svg.resource_limit_exceeded'
  );
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxPathSegments: 1 }),
    'slides.svg.resource_limit_exceeded'
  );
  expectAdmissionCode(
    () => admitSvgPhase0(fixture.source, { ...SVG_PHASE_0_PROTOTYPE_POLICY, maxTextLength: 1 }),
    'slides.svg.resource_limit_exceeded'
  );
}

function expectAdmissionCode(operation: () => void, expectedCode: string): void {
  try {
    operation();
    throw new Error(`期望 ${expectedCode}，但 admission 成功。`);
  } catch (error) {
    if (!(error instanceof SvgPhase0AdmissionError) || error.code !== expectedCode) throw error;
  }
}

async function createRasterWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width: RASTER_WIDTH,
    height: RASTER_HEIGHT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  return window;
}

async function rasterizeInChromium(
  window: BrowserWindow,
  svg: string,
  width: number,
  height: number
): Promise<Buffer> {
  const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const script = `(async () => {
    const image = new Image();
    image.decoding = 'sync';
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(undefined);
      image.onerror = () => reject(new Error('Chromium SVG decode failed'));
    });
    image.src = ${JSON.stringify(svgDataUri)};
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = ${width};
    canvas.height = ${height};
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      pngBase64: canvas.toDataURL('image/png').split(',')[1],
      width: canvas.width,
      height: canvas.height,
    };
  })()`;
  const value: unknown = await window.webContents.executeJavaScript(script, true);
  if (!isBrowserRasterResult(value) || value.width !== width || value.height !== height) {
    throw new Error('Chromium SVG raster 返回了非法结果。');
  }
  return Buffer.from(value.pngBase64, 'base64');
}

async function rasterizeWithSharp(svg: string, width: number, height: number): Promise<Buffer> {
  return await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function comparePngs(
  left: Buffer,
  right: Buffer,
  background: string
): Promise<PixelComparison> {
  const [leftPixels, rightPixels] = await Promise.all([
    decodeRgb(left, background),
    decodeRgb(right, background),
  ]);
  if (
    leftPixels.info.width !== rightPixels.info.width ||
    leftPixels.info.height !== rightPixels.info.height ||
    leftPixels.data.length !== rightPixels.data.length
  ) {
    throw new Error('Renderer comparison 尺寸不一致。');
  }

  let absoluteError = 0;
  let maxChannelError = 0;
  let differentPixels = 0;
  for (let offset = 0; offset < leftPixels.data.length; offset += 3) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(
        leftPixels.data[offset + channel] - rightPixels.data[offset + channel]
      );
      absoluteError += error;
      maxChannelError = Math.max(maxChannelError, error);
      if (error > 8) pixelDiffers = true;
    }
    if (pixelDiffers) differentPixels += 1;
  }
  const pixelCount = leftPixels.info.width * leftPixels.info.height;
  return {
    background,
    meanAbsoluteError: round(absoluteError / leftPixels.data.length),
    maxChannelError,
    differentPixelRate: round(differentPixels / pixelCount),
  };
}

async function decodeRgb(buffer: Buffer, background: string) {
  return await sharp(buffer)
    .flatten({ background })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function createSvgPptx(
  admissions: ReadonlyMap<string, SvgPhase0AdmissionReport>
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Linnya Slides SVG Phase 0';
  pptx.subject = 'SVG dual-media compatibility validation';
  pptx.title = 'SVG Phase 0 validation';

  for (const fixture of SVG_PHASE_0_VALID_FIXTURES) {
    const admission = admissions.get(fixture.id);
    if (!admission) throw new Error(`缺少 ${fixture.id} admission。`);
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({
      data: `data:image/svg+xml;base64,${Buffer.from(admission.canonicalSvg).toString('base64')}`,
      x: 0,
      y: 0,
      w: 13.333333,
      h: 7.5,
      altText: fixture.description,
      objectName: objectNameForFixture(fixture.id),
    });
  }
  const result = await pptx.write({ outputType: 'nodebuffer' });
  if (!Buffer.isBuffer(result)) {
    throw new Error(`PptxGenJS 返回了非 Buffer 结果：${typeof result}`);
  }
  return result;
}

async function replaceSvgFallbacks(
  pptx: Buffer,
  fallbackByFixtureId: ReadonlyMap<string, Buffer>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptx);
  for (let index = 0; index < SVG_PHASE_0_VALID_FIXTURES.length; index++) {
    const fixture = SVG_PHASE_0_VALID_FIXTURES[index];
    const binding = await readSvgPictureBinding(zip, index + 1, objectNameForFixture(fixture.id));
    const fallback = fallbackByFixtureId.get(fixture.id);
    if (!fallback) throw new Error(`缺少 ${fixture.id} Chromium fallback。`);
    zip.file(binding.fallbackPartPath, fallback);
  }
  return await zip.generateAsync({ type: 'nodebuffer' });
}

async function auditPptx(
  pptx: Buffer,
  admissions: ReadonlyMap<string, SvgPhase0AdmissionReport>,
  expectBrokenFallback: boolean
) {
  const zip = await JSZip.loadAsync(pptx);
  const contentTypes = await requireZipText(zip, '[Content_Types].xml');
  if (!contentTypes.includes('Extension="svg"') || !contentTypes.includes('image/svg+xml')) {
    throw new Error('PPTX 缺少 SVG content type。');
  }

  const bindings: Array<
    SvgPictureBinding & {
      readonly fallbackHash: string;
      readonly svgHash: string;
      readonly fallbackWidth: number;
      readonly fallbackHeight: number;
    }
  > = [];
  for (let index = 0; index < SVG_PHASE_0_VALID_FIXTURES.length; index++) {
    const fixture = SVG_PHASE_0_VALID_FIXTURES[index];
    const admission = admissions.get(fixture.id);
    if (!admission) throw new Error(`缺少 ${fixture.id} admission。`);
    const binding = await readSvgPictureBinding(zip, index + 1, objectNameForFixture(fixture.id));
    const fallback = await requireZipBytes(zip, binding.fallbackPartPath);
    const svg = await requireZipText(zip, binding.svgPartPath);
    const fallbackHash = sha256(fallback);
    const svgAdmission = admitSvgPhase0(svg);
    if (svgAdmission.contentHash !== admission.contentHash) {
      throw new Error(`${fixture.id}: PPTX 内 SVG hash 与 admission 不一致。`);
    }
    if (expectBrokenFallback !== (fallbackHash === BROKEN_FALLBACK_HASH)) {
      throw new Error(`${fixture.id}: fallback broken 状态不符合预期，hash=${fallbackHash}。`);
    }
    const metadata = await sharp(fallback).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`${fixture.id}: fallback 不能完整解码。`);
    }
    if (
      !expectBrokenFallback &&
      (metadata.width !== RASTER_WIDTH || metadata.height !== RASTER_HEIGHT)
    ) {
      throw new Error(`${fixture.id}: 真实 fallback 尺寸错误。`);
    }
    bindings.push({
      ...binding,
      fallbackHash,
      svgHash: svgAdmission.contentHash,
      fallbackWidth: metadata.width,
      fallbackHeight: metadata.height,
    });
  }
  return { packageHash: sha256(pptx), bytes: pptx.length, bindings };
}

async function readSvgPictureBinding(
  zip: JSZip,
  slideIndex: number,
  objectName: string
): Promise<SvgPictureBinding> {
  const slidePath = `ppt/slides/slide${slideIndex}.xml`;
  const relsPath = `ppt/slides/_rels/slide${slideIndex}.xml.rels`;
  const slideDocument = parseXml(await requireZipText(zip, slidePath));
  const relationshipsDocument = parseXml(await requireZipText(zip, relsPath));
  const picture = [...Array.from(slideDocument.getElementsByTagName('p:pic'))].find(
    candidate =>
      candidate.getElementsByTagName('p:cNvPr').item(0)?.getAttribute('name') === objectName
  );
  if (!picture) throw new Error(`${slidePath}: 找不到对象 ${objectName}。`);

  const blip = picture.getElementsByTagName('a:blip').item(0);
  const svgBlip = picture.getElementsByTagName('asvg:svgBlip').item(0);
  const fallbackRelationshipId = blip?.getAttribute('r:embed');
  const svgRelationshipId = svgBlip?.getAttribute('r:embed');
  if (
    !fallbackRelationshipId ||
    !svgRelationshipId ||
    fallbackRelationshipId === svgRelationshipId
  ) {
    throw new Error(`${slidePath}: SVG picture 缺少独立双 relationship。`);
  }

  const relationships = new Map<string, string>();
  for (const relationship of Array.from(
    relationshipsDocument.getElementsByTagName('Relationship')
  )) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) relationships.set(id, target);
  }
  const fallbackTarget = relationships.get(fallbackRelationshipId);
  const svgTarget = relationships.get(svgRelationshipId);
  if (!fallbackTarget || !svgTarget) {
    throw new Error(`${relsPath}: 双 relationship target 不完整。`);
  }

  return {
    slideIndex,
    objectName,
    fallbackRelationshipId,
    svgRelationshipId,
    fallbackPartPath: normalizeSlideRelationshipTarget(fallbackTarget),
    svgPartPath: normalizeSlideRelationshipTarget(svgTarget),
  };
}

function normalizeSlideRelationshipTarget(target: string): string {
  const normalized = path.posix.normalize(path.posix.join('ppt/slides', target));
  if (!normalized.startsWith('ppt/media/')) {
    throw new Error(`SVG relationship 越界：${target}`);
  }
  return normalized;
}

async function measureCorpus(root: string): Promise<CorpusSummary> {
  const paths = await collectSvgPaths(root);
  const measurements: SvgPhase0Metrics[] = [];
  const admittedMeasurements: SvgPhase0Metrics[] = [];
  const rejectionCounts = new Map<string, number>();
  const elementCounts = new Map<string, number>();
  let parseFailureCount = 0;
  let admittedCount = 0;

  for (const svgPath of paths) {
    const source = await fs.readFile(svgPath, 'utf8');
    let metrics: SvgPhase0Metrics;
    try {
      metrics = measureSvgSource(source);
      measurements.push(metrics);
      for (const [name, count] of Object.entries(metrics.elementNames)) {
        elementCounts.set(name, (elementCounts.get(name) ?? 0) + count);
      }
    } catch {
      parseFailureCount += 1;
      continue;
    }

    try {
      admitSvgPhase0(source);
      admittedCount += 1;
      admittedMeasurements.push(metrics);
    } catch (error) {
      const code = error instanceof SvgPhase0AdmissionError ? error.code : 'unknown';
      rejectionCounts.set(code, (rejectionCounts.get(code) ?? 0) + 1);
    }
  }

  return {
    root,
    fileCount: paths.length,
    parseFailureCount,
    admittedCount,
    rejectedCountByCode: Object.fromEntries([...rejectionCounts.entries()].sort()),
    metrics: createMetricDistributions(measurements),
    admittedMetrics: createMetricDistributions(admittedMeasurements),
    frequentElements: [...elementCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count })),
  };
}

function createMetricDistributions(
  measurements: readonly SvgPhase0Metrics[]
): Readonly<Record<keyof Omit<SvgPhase0Metrics, 'elementNames'>, Distribution>> {
  return {
    bytes: distribution(measurements.map(measurement => measurement.bytes)),
    elements: distribution(measurements.map(measurement => measurement.elements)),
    attributes: distribution(measurements.map(measurement => measurement.attributes)),
    maxDepth: distribution(measurements.map(measurement => measurement.maxDepth)),
    pathSegments: distribution(measurements.map(measurement => measurement.pathSegments)),
    textLength: distribution(measurements.map(measurement => measurement.textLength)),
  };
}

async function collectSvgPaths(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return await collectSvgPaths(entryPath);
      return entry.isFile() && entry.name.toLowerCase().endsWith('.svg') ? [entryPath] : [];
    })
  );
  return nested.flat().sort();
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { min: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let outputRoot: string | undefined;
  let corpusRoot: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const current = args[index];
    if (current === '--output') outputRoot = requireArgument(args, ++index, current);
    else if (current === '--corpus') corpusRoot = requireArgument(args, ++index, current);
    else throw new Error(`未知参数：${current}`);
  }
  return { outputRoot, corpusRoot };
}

function requireArgument(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value) throw new Error(`${option} 缺少值。`);
  return value;
}

function parseXml(source: string) {
  return new DOMParser({
    onError(level, message) {
      throw new Error(`${level}: ${message}`);
    },
  }).parseFromString(source, 'application/xml');
}

async function requireZipText(zip: JSZip, partPath: string): Promise<string> {
  const file = zip.file(partPath);
  if (!file) throw new Error(`PPTX 缺少 ${partPath}。`);
  return await file.async('text');
}

async function requireZipBytes(zip: JSZip, partPath: string): Promise<Buffer> {
  const file = zip.file(partPath);
  if (!file) throw new Error(`PPTX 缺少 ${partPath}。`);
  return await file.async('nodebuffer');
}

function assertPng(bytes: Buffer, label: string): void {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length <= signature.length || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error(`${label} 没有返回合法 PNG。`);
  }
}

function isBrowserRasterResult(value: unknown): value is BrowserRasterResult {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'pngBase64' in value &&
    typeof value.pngBase64 === 'string' &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number'
  );
}

function objectNameForFixture(fixtureId: string): string {
  return `Linnya SVG Phase 0 ${fixtureId}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

run().catch(error => {
  console.error(error);
  app.exit(1);
});
