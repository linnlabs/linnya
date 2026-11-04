import { app, BrowserWindow, nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const output = process.argv[2]; if (!output) throw new Error('identity_atlas_output_required');
app.setPath('userData', path.join(output, 'profile')); app.on('window-all-closed', () => {});
const pixels = z.object({ resolution: z.number(), zoom: z.number(), strings: z.array(z.string()), reference: z.string(), image: z.string(), stats: z.unknown() });

async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } });
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
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ sourceCommit: process.env.CANVAS_PROBE_SOURCE_COMMIT,
      sourceDirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', rendererTree: process.env.CANVAS_PROBE_RENDERER_TREE,
      validHardwareRun: false, versions: process.versions, reports, lifecycle, lod: { visible: lod.visible, small: lod.small, panned: lod.panned, cleared: lod.cleared }, context: contextFacts }, null, 2));
    console.log(JSON.stringify({ reports, lifecycle, context: contextFacts }));
  } finally { win.destroy(); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
