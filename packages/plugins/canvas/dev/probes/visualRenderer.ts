import './sceneVisualRenderer';
import { CanvasCardSchema, CanvasCardIdSchema, CanvasEdgeSchema, readCanvasCardCssPalette, type CanvasColor, type CanvasCard } from '../../src/shared';
import { CanvasRenderRequestSchema } from '../../src/shared/rendering';
import { createCardSurface } from '../../src/renderer/hidden-render-worker/functions/createCardSurface';
import { createHtmlCardRasterizer } from '../../src/renderer/capabilities/textRasterization';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/features/cardRendering/styles/canvasMediaContent.css';
import '../../src/renderer/styles/canvas.css';
import { applyVisualNegative, collectVisualTextLayout, type VisualNegative } from './visualOracle';

const source = { kind: 'user', conversationId: null, runId: null };
const content = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '中文 English 🖼️' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '同源正文' }, { type: 'text', text: '粗体', marks: [{ type: 'bold' }] }, { type: 'text', text: '、' },
    { type: 'text', text: '斜体', marks: [{ type: 'italic' }] }, { type: 'text', text: '与标点（测试），不能丢字或截断。' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表、换行和对齐使用相同字体。' }] }] }] },
  { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用段落保留其正文结构。' }] }] },
  { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const text = "中文";\ntext.length;' }] },
  { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文' }] }] },
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'English' }] }] },
  ] }] },
  { type: 'paragraph', content: [{ type: 'text', text: '公式：' }, { type: 'inlineMath', attrs: { latex: 'E=mc^2' } },
    { type: 'text', text: ' 下标', marks: [{ type: 'subscript' }] }, { type: 'text', text: '上标', marks: [{ type: 'superscript' }] },
    { type: 'text', text: '下划线', marks: [{ type: 'underline' }] }] },
  { type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } },
  { type: 'paragraph', content: [{ type: 'text', text: '正式标签：' }, { type: 'documentReference', attrs: { documentId: 'visual-document', referenceId: 'stable-tag' } }] },
  { type: 'paragraph', content: [{ type: 'text', text: '作者保留的红色', marks: [{ type: 'textStyle', attrs: { color: '#cc0000' } }] }] },
] };

let previousKernel: CanvasKernel | null = null;
async function prepare(theme: 'light' | 'dark', material: 'paper' | 'card', color: CanvasColor = 'white', negative?: VisualNegative, eraseGhost = false) {
  previousKernel?.destroy(); previousKernel = null;
  document.body.replaceChildren();
  document.body.style.cssText = 'margin:0;background:#888';
  const card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color,
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 360, height: 500, parentId: null,
    data: { contentVersion: 1, content } });
  const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'visual', kind: 'render', theme, material,
    fontFamily: 'system-ui', fontSize: 14, dpr: devicePixelRatio, width: 1000, height: 600, region: null,
    quality: 1, format: 'png', snapshot: { schemaVersion: 1, documentId: 'visual', sequence: 1, elements: [card] }, assets: {}, documents: { 'visual-document': { title: '同源标签', status: 'available' } } });
  const reference = createCardSurface(card, request);
  if (!reference.querySelector('.katex') || !reference.querySelector('.katex-display')) throw new Error('visual_math_is_not_formal_katex');
  const background = readCanvasCardCssPalette(card.color, theme === 'dark').paper;
  reference.style.cssText += `;position:absolute;left:20px;top:20px;width:360px;height:500px;background:${background}`;
  const staging = document.createElement('div');
  document.body.append(reference, staging);
  const rasterizer = createHtmlCardRasterizer({ host: staging });
  const broken = document.createElement('div'), brokenImage = document.createElement('img'); brokenImage.src = 'data:image/png;base64,AA=='; broken.append(brokenImage);
  const measurements = await rasterizer.measureBatch([... [180, 360, 720].map(width => ({ element: createCardSurface(card, request), width })), { element: broken, width: 360 }]);
  const measuredHeights = measurements.map(result => result.status === 'fulfilled' ? result.value : null);
  if (measurements[0].status !== 'fulfilled' || measurements[1].status !== 'fulfilled' || measurements[2].status !== 'fulfilled'
    || measurements[3].status !== 'rejected' || measurements[0].value <= measurements[2].value || measurements[0].value < measurements[1].value) throw new Error('batch_measurement_width_or_failure_isolation_mismatch');
  await document.fonts.ready;
  const paperColor = getComputedStyle(reference).backgroundColor;
  const referenceLayout = collectVisualTextLayout(reference, paperColor);
  const sources = Array.from({ length: 8 }, () => createCardSurface(card, request));
  const mutation = negative ? sources.map(element => applyVisualNegative(element, negative, referenceLayout)) : null;
  const rasters = await rasterizer.rasterizeBatch(sources.map(element => ({ element, width: 360, height: 500, scale: devicePixelRatio })));
  // 返回时真实paint源clone仍在staging；在dispose之前读它们，不用另造“近似相同”的测量DOM。
  const paintedSources = Array.from(staging.querySelectorAll<HTMLElement>('.markdown-document-content'));
  if (paintedSources.length !== sources.length) throw new Error('visual_painted_source_count_mismatch');
  const rasterLayouts = paintedSources.map(element => collectVisualTextLayout(element, paperColor));
  const raster = rasters[7];
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:absolute;left:420px;top:20px;width:360px;height:500px;background:${background}`;
  canvas.width = raster.bitmap.width; canvas.height = raster.bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('visual_context_missing');
  context.drawImage(raster.bitmap, 0, 0);
  document.body.append(canvas);
  const kernelHost = document.createElement('div');
  kernelHost.style.cssText = 'position:absolute;left:820px;top:20px;width:360px;height:500px';
  document.body.append(kernelHost);
  const kernel = await createPixiCanvasKernel({ host: kernelHost, width: 360, height: 500, resolution: devicePixelRatio });
  previousKernel = kernel;
  const paragraph = reference.querySelector('p');
  if (!paragraph) throw new Error('visual_text_fixture_missing');
  const ghostY = paragraph.getBoundingClientRect().top - reference.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(paragraph).lineHeight) / 2;
  const ghost = CanvasEdgeSchema.parse({ id: 'e1', type: 'edge', schemaVersion: 1, revision: 1, order: 'a1', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, from: { kind: 'point', x: 0, y: ghostY }, to: { kind: 'point', x: 360, y: ghostY },
    lineStyle: 'straight', direction: 'none', label: '' });
  kernel.setElements([card, ghost]);
  kernel.setAppearance({ dark: theme === 'dark', material, overview: 'titles' });
  let bodyBitmap = await createImageBitmap(rasters[0].bitmap);
  const ghostErasure = eraseGhost ? { fromY: Math.floor((ghostY - 2) * devicePixelRatio), toY: Math.ceil((ghostY + 2) * devicePixelRatio) } : null;
  if (ghostErasure) {
    // 独立控制只损坏真正交给Kernel的body副本；旁边的raster基线必须保持正确。
    const damaged = new OffscreenCanvas(bodyBitmap.width, bodyBitmap.height), target = damaged.getContext('2d');
    if (!target) throw new Error('ghost_negative_context_missing');
    target.drawImage(bodyBitmap, 0, 0); target.fillStyle = background;
    target.fillRect(0, ghostErasure.fromY, damaged.width, ghostErasure.toY - ghostErasure.fromY);
    bodyBitmap.close(); bodyBitmap = damaged.transferToImageBitmap();
  }
  kernel.setBitmap(card.id, card.revision, 'visual', bodyBitmap);
  rasters.forEach(result => result.bitmap.close()); rasterizer.dispose(); staging.remove();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const rectangle = (element: HTMLElement) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio, reference: rectangle(reference), raster: rectangle(canvas),
    pixi: rectangle(kernelHost), ghostY, measuredHeights, textLayout: { reference: referenceLayout, rasters: rasterLayouts }, negative: negative ?? null, mutation, ghostErasure };
}
Object.defineProperty(window, 'prepareCanvasVisualProbe', { value: prepare });
Object.defineProperty(window, 'prepareCanvasGhostEraseProbe', { value: () => prepare('light', 'paper', 'white', undefined, true) });

async function lineVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const common = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
  const cards = [CanvasCardSchema.parse({ ...common, id: 'c1', type: 'text', x: 40, y: 60, width: 200, height: 180, parentId: null, data: { contentVersion: 1, content } }),
    CanvasCardSchema.parse({ ...common, id: 'c2', type: 'text', x: 600, y: 60, width: 200, height: 180, parentId: null, data: { contentVersion: 1, content } })];
  const selected = CanvasEdgeSchema.parse({ ...common, id: 'e1', type: 'edge', lineStyle: 'curve', linePattern: 'solid', direction: 'forward', label: '可选中的曲线',
    from: { kind: 'card', cardId: cards[0].id, side: 'auto' }, to: { kind: 'card', cardId: cards[1].id, side: 'auto' } });
  const dashed = CanvasEdgeSchema.parse({ ...common, id: 'e2', type: 'edge', lineStyle: 'straight', linePattern: 'dashed', direction: 'both', label: '',
    from: { kind: 'point', x: 40, y: 350 }, to: { kind: 'point', x: 800, y: 350 } });
  const loose = ['none', 'forward', 'both'].map((direction, index) => CanvasEdgeSchema.parse({ ...common, id: `e${index + 3}`, type: 'edge', color: 'purple', direction,
    lineStyle: 'straight', label: '', from: { kind: 'point', x: 100, y: 450 + index * 50 }, to: { kind: 'point', x: 500, y: 450 + index * 50 } }));
  kernel.setElements([...cards, selected, dashed, ...loose]); kernel.setSelectedEdge(selected.id);
  const geometry = kernel.readEdgeGeometry(selected.id);
  if (!geometry || kernel.hitTestEdge(geometry.midpoint)?.id !== selected.id || kernel.hitTestEdge({ x: geometry.midpoint.x, y: geometry.midpoint.y + 7 })?.id === selected.id) {
    throw new Error('line_geometry_hit_range_mismatch');
  }
  const image = await kernel.captureImage('png'); kernel.setCamera({ x: 0, y: 0, zoom: 0.5 });
  return { dpr: devicePixelRatio, image, half: await kernel.captureImage('png') };
}
Object.defineProperty(window, 'prepareCanvasLineVisualProbe', { value: lineVisual });

async function mapPanVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 1000, height: 300, parentId: null, data: { contentVersion: 1, content } });
  kernel.setElements([card]); kernel.setCamera({ x: 100, y: 100, zoom: 0.1 });
  const before = await kernel.captureImage('png');
  kernel.setCamera({ x: 120, y: 110, zoom: 0.1 });
  return { before, after: await kernel.captureImage('png'), dpr: devicePixelRatio, dx: 20, dy: 10 };
}
Object.defineProperty(window, 'prepareCanvasMapPanVisualProbe', { value: mapPanVisual });

async function thumbnailVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const common = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    y: 0, width: 1000, height: 600, parentId: null };
  const cards = [CanvasCardSchema.parse({ ...common, id: 'c1', x: 0, type: 'image', data: { assetId: 'image', caption: '', alt: '', crop: null } }),
    CanvasCardSchema.parse({ ...common, id: 'c2', x: 1500, type: 'document', data: { documentId: 'thumbnail' } }),
    CanvasCardSchema.parse({ ...common, id: 'c3', x: 3000, type: 'document', data: { documentId: 'title' } })];
  kernel.setElements(cards); kernel.setThumbnailCards(new Set([cards[1].id])); kernel.setCamera({ x: 100, y: 100, zoom: 0.1 });
  const picture = new OffscreenCanvas(20, 20), context = picture.getContext('2d'); if (!context) throw new Error('thumbnail_fixture_context_missing');
  context.fillStyle = '#e000cc'; context.fillRect(0, 0, 10, 20); context.fillStyle = '#00c8ee'; context.fillRect(10, 0, 10, 20);
  for (const card of cards) kernel.setBitmap(card.id, card.revision, 'thumbnail', await createImageBitmap(picture));
  const titles = await kernel.captureImage('png'); kernel.setAppearance({ dark: false, material: 'paper', overview: 'thumbnails' });
  const thumbnails = await kernel.captureImage('png');
  return { titles, thumbnails, dpr: devicePixelRatio };
}
Object.defineProperty(window, 'prepareCanvasThumbnailVisualProbe', { value: thumbnailVisual });

async function contextLossVisual() {
  await prepare('light', 'paper'); const kernel = previousKernel; if (!kernel) throw new Error('context_fixture_missing');
  const before = await kernel.captureImage('png'), beforeStats = kernel.readStats();
  const gl = kernel.canvas.getContext('webgl2') ?? kernel.canvas.getContext('webgl'), extension = gl?.getExtension('WEBGL_lose_context');
  if (!extension) throw new Error('context_loss_extension_unavailable');
  const wait = async (phase: string) => {
    const started = performance.now();
    while (kernel.readRenderStatus().phase !== phase && performance.now() - started < 5000) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (kernel.readRenderStatus().phase !== phase) throw new Error(`context_phase_not_reached:${phase}`);
  };
  extension.loseContext(); await wait('restoring');
  let rejected = false; try { await kernel.captureImage('png'); } catch (error) { rejected = error instanceof Error && error.message === 'canvas_graphics_context_lost'; }
  if (!rejected) throw new Error('lost_context_export_was_not_rejected');
  extension.restoreContext(); await wait('ready');
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { before, after: await kernel.captureImage('png'), beforeStats, afterStats: kernel.readStats(), rejected };
}
Object.defineProperty(window, 'prepareCanvasContextLossVisualProbe', { value: contextLossVisual });

async function unsupportedApiVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'), staging = document.createElement('div'); host.style.cssText = 'width:360px;height:240px'; document.body.append(host, staging);
  const card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 300, height: 180, parentId: null, data: { contentVersion: 1, content } });
  const kernel = await createPixiCanvasKernel({ host, width: 360, height: 240, resolution: devicePixelRatio }); previousKernel = kernel; kernel.setElements([card]);
  const errors: string[] = [], raster = createCanvasRasterPresentation({ host: staging, kernel, readAppearance: () => ({ dark: false, material: 'paper', overview: 'titles' }), reportFailure: message => errors.push(message) });
  try {
    raster.refresh(); const started = performance.now();
    while (!raster.readStats().failed && performance.now() - started < 3000) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (await raster.prepareEditing(card.id) !== 'unavailable') throw new Error('unsupported_api_locked_editing');
    if (!errors.includes('html_canvas_unavailable') || kernel.readStats().bitmaps !== 0) throw new Error(`unsupported_api_did_not_keep_identity:${errors}`);
    return { image: await kernel.captureImage('png'), errors, stats: kernel.readStats() };
  } finally { raster.dispose(); }
}
Object.defineProperty(window, 'prepareCanvasUnsupportedApiVisualProbe', { value: unsupportedApiVisual });

async function mixedLodVisual(theme: 'light' | 'dark') {
  await prepare(theme, 'paper'); const kernel = previousKernel; if (!kernel) throw new Error('lod_fixture_missing');
  const card = kernel.visibleCards()[0]; kernel.setElements([card]); kernel.invalidateBitmaps(); kernel.setCamera({ x: 0, y: 0, zoom: 0.6 });
  const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'lod', kind: 'render', theme, material: 'paper', fontFamily: 'system-ui', fontSize: 14,
    dpr: devicePixelRatio, width: 1000, height: 600, region: null, quality: 1, format: 'png', snapshot: { schemaVersion: 1, documentId: 'lod', sequence: 1, elements: [card] },
    documents: { 'visual-document': { title: '同源标签', status: 'available' } } });
  const staging = document.createElement('div'); document.body.append(staging); const rasterizer = createHtmlCardRasterizer({ host: staging });
  try {
    const low = await rasterizer.rasterize({ element: createCardSurface(card, request), width: 360, height: 500, scale: devicePixelRatio });
    const high = await rasterizer.rasterize({ element: createCardSurface(card, request), width: 360, tileWidth: 180, height: 250, offsetX: 20, offsetY: 60, scale: devicePixelRatio * 2 });
    const expected = document.createElement('canvas'); expected.width = 360 * devicePixelRatio; expected.height = 500 * devicePixelRatio;
    const context = expected.getContext('2d'); if (!context) throw new Error('lod_oracle_context_missing');
    const factor = devicePixelRatio * 0.6; context.fillStyle = readCanvasCardCssPalette(card.color, theme === 'dark').paper; context.fillRect(0, 0, expected.width, expected.height);
    context.drawImage(low.bitmap, 0, 0, 360 * factor, 500 * factor);
    context.fillRect(20 * factor, 60 * factor, 180 * factor, 250 * factor); context.drawImage(high.bitmap, 20 * factor, 60 * factor, 180 * factor, 250 * factor);
    kernel.setRasterTiles(card.id, card.revision, 'bucket', [{ bitmap: low.bitmap, x: 0, y: 0, width: 360, height: 500, scale: devicePixelRatio }]);
    kernel.setRasterTiles(card.id, card.revision, 'bucket', [{ bitmap: high.bitmap, x: 20, y: 60, width: 180, height: 250, scale: devicePixelRatio * 2 }]);
    const frame = [{ x: 0, y: 0, width: 360, height: 500 }];
    if (kernel.readMissingBitmapRegions(card.id, 'bucket', frame, { scale: devicePixelRatio, exact: false }).length
      || !kernel.readMissingBitmapRegions(card.id, 'bucket', frame, { scale: devicePixelRatio, exact: true }).length) throw new Error('lod_coverage_mode_mismatch');
    if (kernel.readRasterReceipt(card.id, 'bucket')?.rendered !== false) throw new Error('unrendered_bitmap_reported_ready');
    while (kernel.readStats().fadingCards) await new Promise<void>(resolve => setTimeout(resolve, 10));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!kernel.readRasterReceipt(card.id, 'bucket')?.rendered) throw new Error('drawn_bitmap_receipt_missing');
    kernel.setEditingCard(card.id);
    if (kernel.readRasterReceipt(card.id, 'bucket')?.rendered !== false) throw new Error('hidden_editor_bitmap_reported_drawn');
    kernel.setEditingCard(null);
    if (kernel.readRasterReceipt(card.id, 'bucket')?.rendered !== false) throw new Error('newly_visible_bitmap_reported_before_draw');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!kernel.readRasterReceipt(card.id, 'bucket')?.rendered) throw new Error('returned_bitmap_was_not_drawn');
    const actual = await kernel.captureImage('png'), bytes = kernel.readStats().bitmapBytes;
    if (bytes !== low.bitmap.width * low.bitmap.height * 4 + high.bitmap.width * high.bitmap.height * 4) throw new Error('cropped_source_memory_counted_more_than_once');
    kernel.invalidateBitmaps();
    if (low.bitmap.width !== 0 || high.bitmap.width !== 0 || kernel.readStats().bitmapBytes !== 0) throw new Error('cropped_source_ownership_not_released');
    return { expected: expected.toDataURL('image/png'), actual };
  } finally { rasterizer.dispose(); staging.remove(); }
}
Object.defineProperty(window, 'prepareCanvasMixedLodVisualProbe', { value: mixedLodVisual });

async function lineColorsVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'purple'] as const;
  const edges = colors.map((color, index) => CanvasEdgeSchema.parse({ id: `e${index + 1}`, type: 'edge', schemaVersion: 1, revision: 1, order: 'a0',
    locked: false, color, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, lineStyle: 'straight', linePattern: 'solid', direction: 'none', label: '',
    from: { kind: 'point', x: 40, y: 60 + index * 70 }, to: { kind: 'point', x: 850, y: 60 + index * 70 } }));
  kernel.setElements(edges);
  const light = await kernel.captureImage('png'); kernel.setAppearance({ dark: true, material: 'paper', overview: 'titles' });
  return { light, dark: await kernel.captureImage('png'), dpr: devicePixelRatio, colors };
}
Object.defineProperty(window, 'prepareCanvasLineColorsVisualProbe', { value: lineColorsVisual });

async function dragOcclusionVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const base = { type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    width: 300, height: 180, parentId: null, data: { contentVersion: 1, content } };
  const bottom = CanvasCardSchema.parse({ ...base, id: 'c1', x: 50, y: 60 }), top = CanvasCardSchema.parse({ ...base, id: 'c2', x: 30, y: 40, width: 340, height: 220, order: 'b0' });
  kernel.setElements([bottom, top]);
  const picture = new OffscreenCanvas(30, 18), context = picture.getContext('2d'); if (!context) throw new Error('occlusion_fixture_context_missing');
  context.fillStyle = '#e000cc'; context.fillRect(0, 0, 30, 18); kernel.setBitmap(bottom.id, bottom.revision, 'body', await createImageBitmap(picture));
  const before = await kernel.captureImage('png'); kernel.setDragPreview([top.id], 400, 0);
  const during = await kernel.captureImage('png'); kernel.clearDragPreview();
  return { before, during, after: await kernel.captureImage('png'), dpr: devicePixelRatio };
}
Object.defineProperty(window, 'prepareCanvasDragOcclusionVisualProbe', { value: dragOcclusionVisual });

async function prepareEditingVisual() {
  previousKernel?.destroy(); document.body.replaceChildren(); document.body.style.fontFamily = 'system-ui';
  const host = document.createElement('div'), staging = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host, staging);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const short = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中Aa' }] }] };
  const cards = Array.from({ length: 50 }, (_, i) => CanvasCardSchema.parse({ id: `c${i + 1}`, type: 'text', schemaVersion: 1, revision: 1, order: 'a0',
    locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: (i % 10) * 90, y: Math.floor(i / 10) * 100,
    width: 80, height: 80, parentId: null, data: { contentVersion: 1, content: short } }));
  kernel.setElements(cards);
  const errors: string[] = [], raster = createCanvasRasterPresentation({ host: staging, kernel, suspendWhenHidden: false,
    readAppearance: () => ({ dark: false, material: 'paper', overview: 'titles' }), reportFailure: error => errors.push(error) });
  try {
    if (raster.readReadiness([cards[0].id]).complete) throw new Error('unpainted_body_reported_ready');
    const status = await raster.prepareEditing(cards[0].id), before = raster.readStats().completed;
    const again = await raster.prepareEditing(cards[0].id), after = raster.readStats().completed;
    if (status !== 'ready' || again !== 'ready' || before !== after || errors.length || kernel.readStats().bitmaps === 0) throw new Error('editing_exact_prepare_did_not_finish_or_reuse');
    const inkHost = document.createElement('div'); document.body.append(inkHost);
    const direct = createHtmlCardRasterizer({ host: inkHost });
    try {
      const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'editing-exact', kind: 'render', theme: 'light', material: 'paper', fontFamily: 'system-ui', fontSize: 14,
        dpr: devicePixelRatio, width: 900, height: 600, region: null, quality: 1, format: 'png', snapshot: { schemaVersion: 1, documentId: 'exact', sequence: 1, elements: [cards[0]] } });
      const result = await direct.rasterize({ element: createCardSurface(cards[0], request), width: 80, height: 80, scale: devicePixelRatio });
      const expected = new OffscreenCanvas(result.bitmap.width, result.bitmap.height), context = expected.getContext('2d'); if (!context) throw new Error('editing_oracle_context_missing');
      context.fillStyle = '#fff'; context.fillRect(0, 0, expected.width, expected.height); context.drawImage(result.bitmap, 0, 0); result.bitmap.close();
      const blob = await expected.convertToBlob({ type: 'image/png' });
      const expectedUrl = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
      const actual = await kernel.captureImage('png');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const readiness = raster.readReadiness([cards[0].id]);
      if (!readiness.complete || readiness.cards[0].mode !== 'body' || readiness.cards[0].status !== 'ready') throw new Error('actual_body_draw_receipt_missing');
      if (raster.readReadiness([CanvasCardIdSchema.parse('c999')]).complete) throw new Error('absent_card_reported_body_ready');
      kernel.setCamera({ x: 0, y: 0, zoom: 0.1 }); raster.refresh();
      const overview = raster.readReadiness([cards[0].id]);
      if (overview.complete || overview.cards[0].mode !== 'overview') throw new Error('overview_was_counted_as_body');
      kernel.setCamera({ x: 0, y: 0, zoom: 1 });
      await raster.prepareEditing(cards[0].id);
      staging.style.setProperty('-webkit-font-smoothing', 'antialiased');
      const smoothing = await raster.prepareEditing(cards[0].id);
      if (smoothing !== 'ready' || raster.readStats().completed <= after) throw new Error('font_smoothing_did_not_invalidate_exact_bitmap');
      return { status, again, before, after, expected: expectedUrl, actual, dpr: devicePixelRatio, visible: kernel.visibleCards().length, smoothing };
    } finally { direct.dispose(); inkHost.remove(); }
  } finally {
    raster.dispose(); kernel.destroy(); previousKernel = null;
    const closed = raster.readReadiness([cards[0].id]);
    if (closed.complete || !closed.suspended || closed.cards[0].mode !== 'outside') throw new Error('disposed_readiness_touched_closed_renderer');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
Object.defineProperty(window, 'prepareCanvasEditingVisualProbe', { value: prepareEditingVisual });

async function guidesVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  kernel.setCamera({ x: 40, y: 20, zoom: 0.5 });
  kernel.setGuides([{ from: { x: 100, y: 200 }, to: { x: 1100, y: 200 } }]);
  const shown = await kernel.captureImage('png'); kernel.setGuides([]);
  return { shown, hidden: await kernel.captureImage('png') };
}
Object.defineProperty(window, 'prepareCanvasGuidesVisualProbe', { value: guidesVisual });

async function selectedMapVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:600px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 900, height: 600, resolution: devicePixelRatio }); previousKernel = kernel;
  const base = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    type: 'text', x: 0, y: 0, width: 1000, height: 300, parentId: null };
  const white = CanvasCardSchema.parse({ ...base, id: 'c1', color: 'white', data: { contentVersion: 1,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MapSelectedTarget' }] }] } } });
  const red = CanvasCardSchema.parse({ ...base, id: 'c2', color: 'red', order: 'b0', data: { contentVersion: 1,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RedPriority' }] }] } } });
  kernel.setElements([white, red]); kernel.setCamera({ x: 100, y: 100, zoom: 0.1 });
  const before = await kernel.captureImage('png'); kernel.setSelection([white.id]); const selected = await kernel.captureImage('png');
  kernel.setElements([white]); return { before, selected, reference: await kernel.captureImage('png') };
}
Object.defineProperty(window, 'prepareCanvasSelectedMapVisualProbe', { value: selectedMapVisual });

let fadeFixture: { readonly kernel: CanvasKernel; readonly card: CanvasCard; readonly old: ImageBitmap;
  readonly blue: ImageBitmap; green?: ImageBitmap; readonly started: number } | undefined;
function colorBitmap(width: number, height: number, color: string): ImageBitmap {
  const source = new OffscreenCanvas(width, height), context = source.getContext('2d'); if (!context) throw new Error('fade_context_missing');
  context.fillStyle = color; context.fillRect(0, 0, width, height); return source.transferToImageBitmap();
}
async function beginFadeVisual() {
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); document.body.append(host); host.style.cssText = 'width:400px;height:250px';
  const kernel = await createPixiCanvasKernel({ host, width: 400, height: 250, resolution: devicePixelRatio }); previousKernel = kernel;
  const card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 20, y: 20, width: 200, height: 140, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
  kernel.setElements([card]);
  const old = colorBitmap(50, 35, '#e02020'), blue = colorBitmap(100, 70, '#2030e0');
  kernel.setRasterTiles(card.id, 1, 'old', [{ bitmap: old, x: 0, y: 0, width: 200, height: 140, scale: 0.25 }]);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const before = await kernel.captureImage('png');
  fadeFixture = { kernel, card, old, blue, started: performance.now() };
  kernel.setRasterTiles(card.id, 1, 'new', [{ bitmap: blue, x: 0, y: 0, width: 200, height: 140, scale: 0.5 }]);
  return { before, ...await readFadeVisual() };
}
async function readFadeVisual() {
  const state = fadeFixture; if (!state) throw new Error('fade_fixture_missing');
  return { image: await state.kernel.captureImage('png'), elapsed: performance.now() - state.started, dpr: devicePixelRatio,
    stats: state.kernel.readStats(), oldWidth: state.old.width, blueWidth: state.blue.width, greenWidth: state.green?.width ?? 0,
    rendered: state.kernel.readRasterReceipt(state.card.id, state.green ? 'green' : 'new')?.rendered ?? false,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
}
async function replaceFadeVisual() {
  const state = fadeFixture; if (!state) throw new Error('fade_fixture_missing');
  state.green = colorBitmap(150, 105, '#20d030');
  state.kernel.setRasterTiles(state.card.id, 1, 'green', [{ bitmap: state.green, x: 0, y: 0, width: 200, height: 140, scale: 0.75 }]);
  return readFadeVisual();
}
async function finishFadePreferenceVisual() {
  const state = fadeFixture; if (!state) throw new Error('fade_fixture_missing');
  const started = performance.now();
  while ((!matchMedia('(prefers-reduced-motion: reduce)').matches || state.kernel.readStats().fadingCards) && performance.now() - started < 2000) await new Promise<void>(resolve => setTimeout(resolve, 5));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const result = await readFadeVisual(); state.kernel.invalidateBitmaps();
  if (state.kernel.readStats().bitmapBytes || state.old.width || state.blue.width || state.green?.width) throw new Error('fade_ownership_not_released');
  return result;
}
Object.defineProperties(window, { beginCanvasFadeVisualProbe: { value: beginFadeVisual }, readCanvasFadeVisualProbe: { value: readFadeVisual },
  replaceCanvasFadeVisualProbe: { value: replaceFadeVisual }, finishCanvasFadePreferenceVisualProbe: { value: finishFadePreferenceVisual } });

async function fadeBudgetVisual() {
  const oldFixture = fadeFixture; if (!oldFixture) throw new Error('fade_fixture_missing');
  previousKernel?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 600, height: 250, bitmapBudgetBytes: 50000 }); previousKernel = kernel;
  const first = oldFixture.card, second = CanvasCardSchema.parse({ ...first, id: 'c2', x: 240, width: 160, height: 120 }); kernel.setElements([first, second]);
  const old = colorBitmap(50, 35, '#e02020'), blue = colorBitmap(100, 70, '#2030e0'), green = colorBitmap(80, 60, '#20d030');
  kernel.setRasterContentKey(first.id, 'authorized-generation'); kernel.setBitmap(first.id, 1, 'old', old);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  kernel.setBitmap(first.id, 1, 'blue', blue);
  const during = kernel.readStats(); kernel.setBitmap(second.id, 1, 'green', green); const reserved = kernel.readStats();
  if (reserved.bitmapBytes > reserved.bitmapBudgetBytes || reserved.bitmaps !== 2 || old.width || blue.width !== 100 || green.width !== 80) throw new Error('fade_retirement_was_not_reserved_within_budget');
  const oversized = colorBitmap(300, 200, '#f000f0');
  if (kernel.setBitmap(second.id, 1, 'oversized', oversized) || oversized.width || !kernel.hasBitmap(second.id, 'green')) throw new Error('oversized_bitmap_destroyed_the_valid_current_entry');
  const replacing = colorBitmap(10, 7, '#9020c0'); kernel.setBitmap(first.id, 1, 'replacing', replacing);
  kernel.setRasterContentKey(first.id, 'inaccessible-generation');
  if (blue.width || replacing.width || kernel.hasBitmap(first.id, 'replacing')) throw new Error('external_content_generation_kept_old_fading_bytes');
  kernel.invalidateBitmaps();
  await new Promise<void>(resolve => setTimeout(resolve, 16));
  if (kernel.readStats().bitmapBytes || kernel.readStats().fadingCards || old.width || blue.width || green.width || replacing.width) throw new Error('cancelled_fade_left_native_bitmaps_or_timers');
  return { during, reserved, cleared: kernel.readStats() };
}
Object.defineProperty(window, 'prepareCanvasFadeBudgetVisualProbe', { value: fadeBudgetVisual });
