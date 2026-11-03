import { app, nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerHiddenWorker, unregisterHiddenWorker, invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { createCanvasHiddenWorkerDefinition, createCanvasRenderRuntime, CanvasRenderingError } from '../../src/backend/features/canvasRender';
import type { CanvasRenderWorkerPort } from '../../src/backend/definitions/canvasRenderWorkerPort';
import { createCanvasCardMeasurement } from '../../src/backend/capabilities/cardMeasurement/createCanvasCardMeasurement';
import { CanvasMeasureRequestSchema, CanvasMeasureBatchRequestSchema, CanvasRenderRequestSchema, type CanvasRenderRequest } from '../../src/shared/rendering';
import { CanvasSnapshotSchema } from '../../src/shared';

const root = process.argv[2];
if (!root) throw new Error('Repository root required');
const output = path.join(root, '_dev_data/canvas-worker-smoke');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const common = { protocol: 1, theme: 'light', dpr: 2, fontFamily: 'system-ui', fontSize: 14 };
const content = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '真实后台画布' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '中文 English 与结构化正文必须使用正式文档 renderer。' }] },
] };

function inkBounds(bytes: Uint8Array) {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  let left = width; let right = -1; let top = height; let bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i] < 110 && pixels[i + 1] < 110 && pixels[i + 2] < 110) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('background_output_has_no_text');
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function verifyManagedImages(port: CanvasRenderWorkerPort, request: CanvasRenderRequest) {
  const pixels = Buffer.alloc(120 * 80 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 30; pixels[i + 1] = 80; pixels[i + 2] = 220; pixels[i + 3] = 255; }
  const source = nativeImage.createFromBitmap(pixels, { width: 120, height: 80 }).toDataURL();
  const caption = { type: 'paragraph', content: [{ type: 'text', text: '受管行内图片' }] };
  const content = { type: 'doc', content: [caption, { type: 'image', attrs: { assetId: 'owned-image', src: 'asset:owned-image', alt: 'fixture' } }] };
  const measurement = createCanvasCardMeasurement(port);
  const measured = await measurement.measure(CanvasMeasureRequestSchema.parse({ ...common, requestId: 'measure-inline-image', kind: 'measure', width: 280,
    content, assets: { 'owned-image': source } }));
  const textOnly = await measurement.measure(CanvasMeasureRequestSchema.parse({ ...common, requestId: 'measure-inline-caption', kind: 'measure', width: 280,
    content: { type: 'doc', content: [caption] } }));
  if (measured.height - textOnly.height < 70) throw new Error('managed_image_not_in_real_layout');
  let missingRejected = false;
  try { await measurement.measure(CanvasMeasureRequestSchema.parse({ ...common, requestId: 'measure-missing-image', kind: 'measure', width: 280, content })); }
  catch (error) { if (!(error instanceof CanvasRenderingError) || error.code !== 'resource_unavailable') throw error; missingRejected = true; }
  if (!missingRejected) throw new Error('missing_asset_reused_cached_measurement');
  const card = request.snapshot.elements.find(element => element.type === 'text');
  if (!card) throw new Error('image_fixture_card_missing');
  const image = await createCanvasRenderRuntime(port).render(CanvasRenderRequestSchema.parse({ ...request, requestId: 'render-inline-image', assets: { 'owned-image': source },
    snapshot: { ...request.snapshot, elements: [{ ...card, height: measured.height, data: { contentVersion: 1, content } }] } }));
  const bitmap = nativeImage.createFromBuffer(Buffer.from(image.bytes)).toBitmap();
  let imagePixels = 0;
  for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 100 && bitmap[i + 1] < 150 && bitmap[i + 2] > 180) imagePixels++;
  if (imagePixels < 1000) throw new Error('managed_image_missing_from_background_png');
  await writeFile(path.join(output, 'canvas-inline-image.png'), image.bytes);
  return { measuredHeight: measured.height, captionHeight: textOnly.height, imagePixels, missingRejected };
}

async function run(): Promise<void> {
  await app.whenReady();
  const packageRoot = path.join(root, 'packages/plugins/canvas');
  const definition = createCanvasHiddenWorkerDefinition({
    workerHtmlPath: path.join(packageRoot, 'dist/render-worker/worker.html'),
    preloadPath: path.join(packageRoot, 'dist/backend/render-worker-preload.cjs'),
  });
  await registerHiddenWorker(definition);
  const port = { invoke: invokeHiddenWorker };
  try {
    const measurement = await createCanvasCardMeasurement(port).measure(CanvasMeasureRequestSchema.parse({ ...common, requestId: 'measure-1', kind: 'measure', width: 280, content }));
    const batchStarted = performance.now();
    const batch = await createCanvasCardMeasurement(port).measureBatch(CanvasMeasureBatchRequestSchema.parse({ ...common, kind: 'measureBatch', requestId: 'measure-batch',
      cards: Array.from({ length: 300 }, (_, i) => ({ ref: `new-${i}`, contentVersion: 1, width: 280 + i % 3, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `第 ${i} 张卡：中文 English 排版需一致。` }] }] } })) }));
    const batchMs = performance.now() - batchStarted;
    if (batch.length !== 300 || batch.some((card, i) => card.ref !== `new-${i}` || card.height < 34)) throw new Error('batch_measurement_mismatch');
    const source = { kind: 'user', conversationId: null, runId: null };
    const card = { id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
      createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
      x: 0, y: 0, width: 280, height: measurement.height, parentId: null, data: { contentVersion: 1, content } };
    const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'smoke-document', sequence: 1, elements: [card] });
    const request = CanvasRenderRequestSchema.parse({ ...common, requestId: 'render-1', kind: 'render', snapshot,
      width: 560, height: 400, region: null, format: 'png', quality: 0.9, material: 'paper', assets: {}, documents: {} });
    const runtime = createCanvasRenderRuntime(port);
    const image = await runtime.render(request);
    const decoded = nativeImage.createFromBuffer(Buffer.from(image.bytes));
    if (decoded.isEmpty() || decoded.getSize().width !== 1120 || decoded.getSize().height !== 800) throw new Error('worker_image_dimensions');
    const unit = await runtime.render({ ...request, requestId: 'render-dpr1', dpr: 1 });
    const bounds1 = inkBounds(unit.bytes);
    const bounds2 = inkBounds(image.bytes);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'canvas-dpr1.png'), unit.bytes);
    await writeFile(path.join(output, 'canvas.png'), image.bytes);
    console.log({ bounds1, bounds2 });
    if (Object.entries(bounds1).some(([key, value]) => { const other: unknown = Reflect.get(bounds2, key); return typeof other !== 'number' || (key === 'x' || key === 'y' ? Math.abs(value * 2 - other) > 4 : Math.abs(other / (value * 2) - 1) > 0.05); })) throw new Error('DPR changed logical text geometry');
    const secondRequest = CanvasRenderRequestSchema.parse({ ...request, requestId: 'render-2', format: 'jpeg', snapshot: { ...snapshot, sequence: 2,
      elements: [{ ...card, revision: 2, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二个版本' }] }] } } }] } });
    const second = await runtime.render(secondRequest);
    if (second.sequence !== 2 || second.format !== 'jpeg' || nativeImage.createFromBuffer(Buffer.from(second.bytes)).isEmpty()) throw new Error('worker_second_version');
    const controller = new AbortController();
    const cancelled = runtime.render({ ...request, requestId: 'render-cancel', width: 2048, height: 2048 }, controller.signal);
    // Host 已复用就绪窗口；下一轮 timer 在 IPC 发出后中断，验证真正的跨进程取消入口。
    const cancelTimer = setTimeout(() => controller.abort(), 1);
    let cancellationObserved = false;
    try { await cancelled; } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('cancelled')) throw error;
      cancellationObserved = true;
    } finally { clearTimeout(cancelTimer); }
    if (!cancellationObserved) throw new Error('worker_cancel_did_not_interrupt');
    const afterCancel = await createCanvasCardMeasurement(port).measure(CanvasMeasureRequestSchema.parse({ ...common,
      requestId: 'measure-after-cancel', kind: 'measure', width: 280, content }));
    if (afterCancel.height !== measurement.height) throw new Error('worker_cancel_poisoned_following_request');
    const wide = await runtime.render(CanvasRenderRequestSchema.parse({ ...request, requestId: 'render-wide', dpr: 4,
      width: 600, height: 300, region: { x: 2400, y: 0, width: 600, height: 300 },
      snapshot: { ...snapshot, elements: [{ ...card, width: 4000, height: 400,
        data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '宽卡切片 Chinese English '.repeat(150) }] }] } } }] } }));
    const wideBounds = inkBounds(wide.bytes);
    const managedImages = await verifyManagedImages(port, request);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'canvas.png'), image.bytes);
    await writeFile(path.join(output, 'canvas-dpr1.png'), unit.bytes);
    await writeFile(path.join(output, 'canvas-second.jpg'), second.bytes);
    await writeFile(path.join(output, 'canvas-wide.png'), wide.bytes);
    const report = { versions: process.versions, measurement, cancellationObserved, wideBounds, managedImages, batch: { count: batch.length, ms: batchMs }, textBounds: { dpr1: bounds1, dpr2: bounds2 }, first: { bytes: image.bytes.length, size: decoded.getSize(), sequence: image.sequence,
      sha256: createHash('sha256').update(image.bytes).digest('hex') }, second: { bytes: second.bytes.length, sequence: second.sequence } };
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await unregisterHiddenWorker(definition.id); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
