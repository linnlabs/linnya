import { app, BrowserWindow, nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';
import { verifyCanvasTitleBoundaryPixels } from './identityTitleBoundaryElectron';

const output = process.argv[2]; if (!output) throw new Error('identity_atlas_output_required');
app.setPath('userData', path.join(output, 'profile')); app.on('window-all-closed', () => {});
const pixels = z.object({ resolution: z.number(), zoom: z.number(), strings: z.array(z.string()), reference: z.string(), image: z.string(), stats: z.unknown() });

async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    await win.loadFile(path.join(output, 'index.html'));
    const reports = [];
    for (const resolution of [1, 2]) for (const zoom of [0.4701834862385321, 1.333]) {
      const state = pixels.parse(await win.webContents.executeJavaScript(`window.canvasIdentityAtlasPixels(${resolution},${zoom})`));
      const expected = nativeImage.createFromDataURL(state.reference), actual = nativeImage.createFromDataURL(state.image);
      const stem = `dpr${resolution}-zoom${zoom}`;
      await writeFile(path.join(output, `${stem}-reference.png`), expected.toPNG());
      await writeFile(path.join(output, `${stem}-atlas.png`), actual.toPNG());
      const a = expected.toBitmap(), b = actual.toBitmap();
      if (a.length !== b.length) throw new Error('identity_atlas_image_size_changed');
      let intersection = 0, union = 0, alphaError = 0, alphaSum = 0, maximumDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] > 16 && b[i + 3] > 16) intersection++;
        if (a[i + 3] > 16 || b[i + 3] > 16) union++;
        alphaError += Math.abs(a[i + 3] - b[i + 3]); alphaSum += a[i + 3];
        maximumDelta = Math.max(maximumDelta, Math.abs(a[i + 3] - b[i + 3]));
      }
      const report = { resolution, zoom, strings: state.strings, stats: state.stats, intersection, union,
        iou: intersection / union, normalizedAlphaError: alphaError / alphaSum, maximumAlphaDelta: maximumDelta };
      reports.push(report); await writeFile(path.join(output, `${stem}-pixels.json`), JSON.stringify(report, null, 2));
      if (!union || report.iou < 0.995 || report.normalizedAlphaError > 0.01) throw new Error('identity_atlas_whole_string_pixels_changed');
    }
    const lifecycle: unknown = await win.webContents.executeJavaScript('window.canvasIdentityAtlasLifecycle()');
    const stats = z.object({ identityActiveLabels: z.number(), identityBytes: z.number() });
    const lod = z.object({ visible: stats, small: stats, panned: stats, cleared: stats, smallImage: z.string() })
      .parse(await win.webContents.executeJavaScript('window.canvasIdentityAtlasHiddenLod()'));
    await writeFile(path.join(output, 'hidden-lod.png'), nativeImage.createFromDataURL(lod.smallImage).toPNG());
    await writeFile(path.join(output, 'hidden-lod.json'), JSON.stringify({ visible: lod.visible, small: lod.small, panned: lod.panned, cleared: lod.cleared }, null, 2));
    if (lod.visible.identityActiveLabels !== 2 || lod.small.identityActiveLabels || lod.panned.identityActiveLabels
      || lod.cleared.identityBytes) throw new Error('identity_hidden_lod_pins_or_redraws_pages');
    const memory = z.object({ bodyBytes: z.number(), identityBytes: z.number() });
    const budget = z.object({ total: z.number(), initial: memory, atlasWins: memory, bodyWins: memory, cleared: memory,
      firstClosed: z.boolean(), secondClosed: z.boolean(), installed: z.boolean() })
      .parse(await win.webContents.executeJavaScript('window.canvasIdentityAtlasSharedBudget()'));
    await writeFile(path.join(output, 'shared-budget.json'), JSON.stringify(budget, null, 2));
    if (budget.initial.bodyBytes !== 40000 || budget.atlasWins.bodyBytes || budget.atlasWins.identityBytes !== 2097152
      || budget.bodyWins.bodyBytes !== 40000 || budget.bodyWins.identityBytes || !budget.installed || !budget.firstClosed || !budget.secondClosed
      || budget.cleared.bodyBytes || budget.cleared.identityBytes
      || [budget.initial, budget.atlasWins, budget.bodyWins].some(value => value.bodyBytes + value.identityBytes > budget.total)) throw new Error('identity_shared_budget_admission_or_release_failed');
    const context = z.object({ before: z.string(), image: z.string(), initial: z.unknown(), restored: z.unknown(), rejected: z.literal(true) })
      .parse(await win.webContents.executeJavaScript('window.canvasIdentityAtlasContext()'));
    const oldImage = nativeImage.createFromDataURL(context.before), restoredImage = nativeImage.createFromDataURL(context.image);
    await writeFile(path.join(output, 'context-before.png'), oldImage.toPNG());
    await writeFile(path.join(output, 'context-restored.png'), restoredImage.toPNG());
    const a = oldImage.toBitmap(), b = restoredImage.toBitmap(); let intersection = 0, union = 0;
    if (a.length !== b.length) throw new Error('identity_context_capture_size_changed');
    for (let i = 0; i < a.length; i += 4) {
      const oldInk = a[i] < 150 && a[i + 1] < 150 && a[i + 2] < 150, newInk = b[i] < 150 && b[i + 1] < 150 && b[i + 2] < 150;
      if (oldInk && newInk) intersection++; if (oldInk || newInk) union++;
    }
    const contextFacts = { initial: context.initial, restored: context.restored, rejected: context.rejected, intersection, union, iou: intersection / union };
    await writeFile(path.join(output, 'context-pixels.json'), JSON.stringify(contextFacts, null, 2));
    if (!union || contextFacts.iou < 0.995) throw new Error('identity_context_restore_lost_current_title_pixels');
    const observation = z.object({ overflow: z.number(), events: z.array(z.object({ kind: z.string(), sourceKind: z.string().optional() }).passthrough()) }).passthrough();
    const map = z.object({ before: z.string(), image: z.string(), expected: z.string(), hidden: z.boolean(), empty: observation, restored: observation })
      .parse(await win.webContents.executeJavaScript('window.canvasEmptyMapLabels()'));
    const oldMap = nativeImage.createFromDataURL(map.before), newMap = nativeImage.createFromDataURL(map.image), expectedMap = nativeImage.createFromDataURL(map.expected);
    await writeFile(path.join(output, 'map-empty-before.png'), oldMap.toPNG());
    await writeFile(path.join(output, 'map-empty-restored.png'), newMap.toPNG());
    await writeFile(path.join(output, 'map-empty-expected.png'), expectedMap.toPNG());
    const mapFacts = { hidden: map.hidden, empty: map.empty, restored: map.restored,
      currentPixelsMatch: newMap.toBitmap().equals(expectedMap.toBitmap()), oldPixelsChanged: !oldMap.toBitmap().equals(newMap.toBitmap()) };
    await writeFile(path.join(output, 'map-empty-facts.json'), JSON.stringify(mapFacts, null, 2));
    if (!mapFacts.hidden || !mapFacts.currentPixelsMatch || !mapFacts.oldPixelsChanged || map.empty.overflow || map.restored.overflow
      || map.empty.events.some(event => event.kind === 'texture-upload')
      || map.restored.events.filter(event => event.kind === 'texture-upload' && event.sourceKind === 'canvas').length !== 1) throw new Error('empty_map_upload_or_stale_title_projection');
    const titleBoundaries = await verifyCanvasTitleBoundaryPixels(win.webContents, output);
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ sourceCommit: process.env.CANVAS_PROBE_SOURCE_COMMIT,
      sourceDirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', rendererTree: process.env.CANVAS_PROBE_RENDERER_TREE,
      validHardwareRun: false, versions: process.versions, reports, lifecycle, budget, titleBoundaries, map: mapFacts, lod: { visible: lod.visible, small: lod.small, panned: lod.panned, cleared: lod.cleared }, context: contextFacts }, null, 2));
    console.log(JSON.stringify({ reports, lifecycle, context: contextFacts }));
  } finally { win.destroy(); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
