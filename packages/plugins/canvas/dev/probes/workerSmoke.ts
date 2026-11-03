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
async function verifyReferenceMeasurement(port: CanvasRenderWorkerPort) {
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '标签：' },
    { type: 'documentReference', attrs: { documentId: 'authorized-document', referenceId: 'stable-reference' } }] }] };
  const measurement = createCanvasCardMeasurement(port);
  const request = { ...common, kind: 'measure', width: 320, content };
  const short = await measurement.measure(CanvasMeasureRequestSchema.parse({ ...request, requestId: 'tag-short', documents: { 'authorized-document': { title: '短标题' } } }));
  const renamed = await measurement.measure(CanvasMeasureRequestSchema.parse({ ...request, requestId: 'tag-rename', documents: { 'authorized-document': { title: '改名后的当前中文标题'.repeat(8) } } }));
  const inaccessible = await measurement.measure(CanvasMeasureRequestSchema.parse({ ...request, requestId: 'tag-inaccessible' }));
  if (renamed.height <= short.height + 10 || inaccessible.height >= renamed.height) throw new Error('tag_title_measurement_reused_stale_metadata');
  return { short: short.height, renamed: renamed.height, inaccessible: inaccessible.height };
}
async function verifyDocumentCover(port: CanvasRenderWorkerPort, request: CanvasRenderRequest) {
  const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#30a090"/></svg>').toString('base64')}`;
  const card = request.snapshot.elements.find(element => element.type === 'text');
  if (!card) throw new Error('cover_fixture_missing');
  const make = (status: 'available' | 'outside_project') => CanvasRenderRequestSchema.parse({ ...request, requestId: `cover-${status}`,
    snapshot: { ...request.snapshot, elements: [{ ...card, type: 'document', height: 240, data: { documentId: 'cover-document' } }] },
    documents: { 'cover-document': { title: status === 'available' ? '正式SVG封面' : '文档当前不可访问', status, image } } });
  const count = (bytes: Uint8Array) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(bytes)).toBitmap(); let matching = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 100 && pixels[i + 1] > 100 && pixels[i + 2] < 100) matching++;
    return matching;
  };
  const runtime = createCanvasRenderRuntime(port), available = await runtime.render(make('available')), outside = await runtime.render(make('outside_project'));
  const shown = count(available.bytes), hidden = count(outside.bytes);
  if (shown < 1000 || hidden !== 0) throw new Error('document_cover_status_or_svg_mismatch');
  await writeFile(path.join(output, 'canvas-svg-cover.png'), available.bytes);
  return { shown, hidden };
}

async function verifyDanglingEdge(port: CanvasRenderWorkerPort, request: CanvasRenderRequest): Promise<number> {
  const source = { kind: 'user', conversationId: null, runId: null };
  const edge = { id: 'e1', type: 'edge', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'red',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, lineStyle: 'straight', linePattern: 'solid', direction: 'none', label: '',
    from: { kind: 'point', x: 10000, y: 10000 }, to: { kind: 'point', x: 10400, y: 10000 } };
  const image = await createCanvasRenderRuntime(port).render(CanvasRenderRequestSchema.parse({ ...request, requestId: 'far-dangling-only',
    snapshot: { ...request.snapshot, elements: [edge] } }));
  const pixels = nativeImage.createFromBuffer(Buffer.from(image.bytes)).toBitmap(); let colored = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > pixels[i + 1] + 30 && pixels[i + 1] < 160 && pixels[i] < 160) colored++;
  if (colored < 500) throw new Error(`dangling_edge_did_not_fit:${colored}`);
  await writeFile(path.join(output, 'canvas-far-dangling-edge.png'), image.bytes); return colored;
}

async function verifyCroppedImage(port: CanvasRenderWorkerPort, request: CanvasRenderRequest) {
  const pixels = Buffer.alloc(200 * 200 * 4);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    const i = (y * 200 + x) * 4;
    pixels[i] = y < 100 ? 40 : 220; pixels[i + 1] = y < 100 ? 50 : 80; pixels[i + 2] = y < 100 ? 220 : 30; pixels[i + 3] = 255;
  }
  const source = nativeImage.createFromBitmap(pixels, { width: 200, height: 200 }).toDataURL();
  const card = request.snapshot.elements.find(element => element.type === 'text'); if (!card) throw new Error('crop_fixture_card_missing');
  const cropped = CanvasRenderRequestSchema.parse({ ...request, requestId: 'vertical-image-crop', assets: { crop: source },
    snapshot: { ...request.snapshot, elements: [{ ...card, type: 'image', width: 200, height: 100,
      data: { assetId: 'crop', caption: '底部图注', alt: '下半蓝色', crop: { x: 0, y: 0.5, width: 1, height: 0.5 } } }] } });
  const runtime = createCanvasRenderRuntime(port), result = await runtime.render(cropped), image = nativeImage.createFromBuffer(Buffer.from(result.bytes));
  const data = image.toBitmap(), width = image.getSize().width; let blue = 0, red = 0, captionInk = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i] > 180 && data[i + 1] < 150 && data[i + 2] < 100) blue++; if (data[i] < 100 && data[i + 1] < 150 && data[i + 2] > 180) red++; }
  for (let y = 420; y < 500; y++) for (let x = 360; x < 760; x++) { const i = (y * width + x) * 4; if (Math.max(data[i], data[i + 1], data[i + 2]) < 140) captionInk++; }
  if (blue < 20000 || red || captionInk < 100) throw new Error(`image_crop_or_caption_missing:${blue}:${red}:${captionInk}`);
  const part = await runtime.render({ ...cropped, requestId: 'image-crop-bottom-region', width: 200, height: 40, region: { x: 0, y: 60, width: 200, height: 40 } });
  const bottom = nativeImage.createFromBuffer(Buffer.from(part.bytes)).toBitmap(); let regionInk = 0;
  for (let i = 0; i < bottom.length; i += 4) if (Math.max(bottom[i], bottom[i + 1], bottom[i + 2]) < 140) regionInk++;
  if (regionInk < 100) throw new Error('image_caption_lost_when_clipping_visible_region');
  const enlarged = await runtime.render({ ...cropped, requestId: 'image-crop-enlarged-region', dpr: 1, width: 1600, height: 320, region: { x: 0, y: 60, width: 200, height: 40 } });
  const enlargedPixels = nativeImage.createFromBuffer(Buffer.from(enlarged.bytes)).toBitmap(); let enlargedInk = 0;
  for (let i = 0; i < enlargedPixels.length; i += 4) if (Math.max(enlargedPixels[i], enlargedPixels[i + 1], enlargedPixels[i + 2]) < 140) enlargedInk++;
  if (enlargedInk < regionInk * 10) throw new Error('capture_region_was_clamped_to_interactive_zoom');
  await writeFile(path.join(output, 'canvas-vertical-image-crop.png'), result.bytes); return { blue, red, captionInk, regionInk, enlargedInk };
}

async function run(): Promise<void> {
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const packageRoot = process.argv[3] ?? path.join(root, 'packages/plugins/canvas');
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
    const referenceMeasurement = await verifyReferenceMeasurement(port);
    const documentCover = await verifyDocumentCover(port, request);
    const danglingEdgePixels = await verifyDanglingEdge(port, request);
    const imageCrop = await verifyCroppedImage(port, request);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'canvas.png'), image.bytes);
    await writeFile(path.join(output, 'canvas-dpr1.png'), unit.bytes);
    await writeFile(path.join(output, 'canvas-second.jpg'), second.bytes);
    await writeFile(path.join(output, 'canvas-wide.png'), wide.bytes);
    const report = { versions: process.versions, measurement, cancellationObserved, danglingEdgePixels, imageCrop, wideBounds, managedImages, referenceMeasurement, documentCover, batch: { count: batch.length, ms: batchMs }, textBounds: { dpr1: bounds1, dpr2: bounds2 }, first: { bytes: image.bytes.length, size: decoded.getSize(), sequence: image.sequence,
      sha256: createHash('sha256').update(image.bytes).digest('hex') }, second: { bytes: second.bytes.length, sequence: second.sequence } };
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await unregisterHiddenWorker(definition.id); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
