import { app, BrowserWindow, nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { VisualTextLayoutSchema } from './visualOracle/definitions';
import { compareVisualTextLayout } from './visualOracle/compareVisualTextLayout';
import { compareVisualTextPixels, visualImageFromBgra } from './visualOracle/compareVisualTextPixels';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const output = process.argv[2]; if (!output) throw new Error('preview_parity_output_required');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const FactsSchema = z.object({ layout: VisualTextLayoutSchema, text: z.string(), dpr: z.number(), blocks: z.array(z.unknown()), images: z.array(z.object({ decoded: z.boolean() }).passthrough()),
  math: z.number(), clipped: z.string().nullable(), bodyHeight: z.number(), width: z.number(), height: z.number() }).passthrough();
type Capture = { facts: z.infer<typeof FactsSchema>; pixels: Buffer; width: number; height: number };
function compare(reference: Capture, actual: Capture, raster: boolean) {
  if (reference.width !== actual.width || reference.height !== actual.height || reference.pixels.length !== actual.pixels.length) throw new Error('preview_parity_capture_size_mismatch');
  let changedPixels = 0, maxDifference = 0;
  for (let i = 0; i < reference.pixels.length; i += 4) {
    let difference = 0;
    for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(reference.pixels[i + channel] - actual.pixels[i + channel]));
    if (difference > 0) changedPixels++;
    maxDifference = Math.max(maxDifference, difference);
  }
  const textLayout = compareVisualTextLayout(reference.facts.layout, actual.facts.layout);
  const layoutEqual = textLayout.pass && JSON.stringify(reference.facts.blocks) === JSON.stringify(actual.facts.blocks)
    && JSON.stringify(reference.facts.images) === JSON.stringify(actual.facts.images);
  const oracle = raster ? compareVisualTextPixels(visualImageFromBgra(reference.pixels, reference.width, reference.height),
    visualImageFromBgra(actual.pixels, actual.width, actual.height), reference.facts.layout) : null;
  return { pass: layoutEqual && (oracle ? oracle.pass : changedPixels === 0), layoutEqual,
    textLayoutFailures: textLayout.failures, pixelOracle: oracle && { pass: oracle.pass, outside: oracle.outsideText, failures: [...oracle.graphemes, ...oracle.lines].filter(region => region.failures.length).map(region => ({ id: region.id, failures: region.failures })) }, textEqual: reference.facts.text === actual.facts.text,
    changedPixels, totalPixels: reference.width * reference.height, maxDifference };
}
async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 500, height: 1600, webPreferences: { sandbox: true, contextIsolation: true,
    offscreen: true, backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  const captures = new Map<string, Capture>(), comparisons: unknown[] = [];
  try {
    const basics: unknown[] = [], batches: unknown[] = [];
    for (const mode of ['first', 'full', 'chart']) {
      await win.loadFile(path.join(output, 'worker', 'index.html'));
      basics.push(await win.webContents.executeJavaScript(`window.measurePreviewBasics(${JSON.stringify(mode)})`));
    }
    await win.loadFile(path.join(output, 'worker', 'index.html'));
    win.setContentSize(2400, 3200);
    for (const temperature of ['cold', 'warm']) {
      const memoryBefore = app.getAppMetrics();
      const result: unknown = await win.webContents.executeJavaScript(`window.measurePreviewBatch(${JSON.stringify(temperature)})`);
      const memoryAfter = app.getAppMetrics();
      if (temperature === 'warm') {
        const png = z.string().parse(await win.webContents.executeJavaScript('window.snapshotPreviewBatch()'));
        await writeFile(path.join(output, 'batch-100.png'), Buffer.from(png.split(',')[1], 'base64'));
      }
      batches.push({ result, memoryBefore, memoryAfter });
      await win.webContents.executeJavaScript('window.releasePreviewBatch()');
    }
    await writeFile(path.join(output, 'timing.json'), JSON.stringify({ basics, batches, hardwareFrameRateQualification: false }, null, 2));
    win.setContentSize(500, 1600);
    for (const environment of ['worker', 'host']) {
      await win.loadFile(path.join(output, environment, 'index.html'));
      for (const theme of ['light', 'dark']) for (const width of [240, 400]) for (const firstScreen of [true, false]) for (const route of ['tag', 'canvas', 'worker']) {
        const name = `${environment}-${theme}-${width}-${firstScreen ? 'first' : 'full'}-${route}`;
        const expression = `window.preparePreviewParity(${JSON.stringify(theme)},${width},${firstScreen},${JSON.stringify(route)})`;
        const facts = FactsSchema.parse(await win.webContents.executeJavaScript(expression));
        if (facts.images.some(image => !image.decoded) || (!firstScreen && (facts.math !== 2 || !facts.text.includes('END')))) throw new Error(`preview_parity_content_missing:${name}`);
        const png = (await win.webContents.capturePage({ x: 0, y: 0, width: facts.width, height: facts.height })).toPNG();
        const image = nativeImage.createFromBuffer(png), size = image.getSize();
        if (size.width !== facts.width * facts.dpr || size.height !== facts.height * facts.dpr) throw new Error(`preview_parity_sampling_mismatch:${name}`);
        await writeFile(path.join(output, `${name}.png`), png);
        await writeFile(path.join(output, `${name}.json`), JSON.stringify(facts, null, 2));
        captures.set(name, { facts, pixels: image.toBitmap(), ...size });
        await win.webContents.executeJavaScript('window.disposePreviewParity()');
      }
    }
    for (const theme of ['light', 'dark']) for (const width of [240, 400]) for (const scope of ['first', 'full']) {
      const suffix = `${theme}-${width}-${scope}`, reference = captures.get(`worker-${suffix}-tag`);
      if (!reference) throw new Error('preview_parity_reference_missing');
      for (const environment of ['worker', 'host']) for (const route of ['tag', 'canvas', 'worker']) {
        const name = `${environment}-${suffix}-${route}`, actual = captures.get(name);
        if (!actual) throw new Error('preview_parity_capture_missing');
        comparisons.push({ name, ...compare(reference, actual, route === 'worker') });
      }
    }
    const failures = comparisons.filter(item => typeof item === 'object' && item !== null && 'pass' in item && !item.pass);
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ versions: process.versions, gpu: await app.getGPUInfo('basic'),
      scope: 'Preview parity only; no performance or model qualification', captures: captures.size, comparisons, failures: failures.length }, null, 2));
    console.log(JSON.stringify({ output, captures: captures.size, failures: failures.length }));
    if (failures.length) process.exitCode = 1;
  } finally { win.destroy(); }
}
void run().then(() => app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0), error => { console.error(error); app.exit(1); });
