import { CanvasCardSchema, CanvasEdgeSchema, readCanvasCardCssPalette, type CanvasColor } from '../../src/shared';
import { CanvasRenderRequestSchema } from '../../src/shared/rendering';
import { createCardSurface } from '../../src/renderer/hidden-render-worker/functions/createCardSurface';
import { createHtmlCardRasterizer } from '../../src/renderer/capabilities/textRasterization';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import '@linnya/markdown-document-core/style.css';

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
async function prepare(theme: 'light' | 'dark', material: 'paper' | 'card', color: CanvasColor = 'white') {
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
  const rasters = await rasterizer.rasterizeBatch(Array.from({ length: 8 }, () => ({ element: createCardSurface(card, request), width: 360, height: 500, scale: devicePixelRatio })));
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
  kernel.setBitmap(card.id, card.revision, 'visual', await createImageBitmap(rasters[0].bitmap));
  rasters.forEach(result => result.bitmap.close()); rasterizer.dispose(); staging.remove();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const rectangle = (element: HTMLElement) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio, reference: rectangle(reference), raster: rectangle(canvas),
    pixi: rectangle(kernelHost), ghostY, measuredHeights };
}
Object.defineProperty(window, 'prepareCanvasVisualProbe', { value: prepare });

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
  kernel.setElements([...cards, selected, dashed]); kernel.setSelectedEdge(selected.id);
  const geometry = kernel.readEdgeGeometry(selected.id);
  if (!geometry || kernel.hitTestEdge(geometry.midpoint)?.id !== selected.id || kernel.hitTestEdge({ x: geometry.midpoint.x, y: geometry.midpoint.y + 7 })?.id === selected.id) {
    throw new Error('line_geometry_hit_range_mismatch');
  }
  return { dpr: devicePixelRatio, image: await kernel.captureImage('png') };
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
