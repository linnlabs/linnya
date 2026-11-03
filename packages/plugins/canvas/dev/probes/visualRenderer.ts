import { CanvasCardSchema } from '../../src/shared';
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
] };

let previousKernel: CanvasKernel | null = null;
async function prepare(theme: 'light' | 'dark', material: 'paper' | 'card') {
  previousKernel?.destroy(); previousKernel = null;
  document.body.replaceChildren();
  document.body.style.cssText = 'margin:0;background:#888';
  const card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 360, height: 500, parentId: null,
    data: { contentVersion: 1, content } });
  const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'visual', kind: 'render', theme, material,
    fontFamily: 'system-ui', fontSize: 14, dpr: devicePixelRatio, width: 1000, height: 600, region: null,
    quality: 1, format: 'png', snapshot: { schemaVersion: 1, documentId: 'visual', sequence: 1, elements: [card] }, assets: {}, documents: {} });
  const reference = createCardSurface(card, request);
  const background = theme === 'light' ? '#fbfaf5' : '#323631';
  reference.style.cssText += `;position:absolute;left:20px;top:20px;width:360px;height:500px;background:${background}`;
  const staging = document.createElement('div');
  document.body.append(reference, staging);
  const rasterizer = createHtmlCardRasterizer({ host: staging });
  const raster = await rasterizer.rasterize({ element: createCardSurface(card, request), width: 360, height: 500, scale: devicePixelRatio });
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
  kernel.setElements([card]);
  kernel.setAppearance({ dark: theme === 'dark', material, overview: 'titles' });
  kernel.setBitmap(card.id, card.revision, 'visual', await createImageBitmap(raster.bitmap));
  raster.bitmap.close(); rasterizer.dispose(); staging.remove();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const rectangle = (element: HTMLElement) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio, reference: rectangle(reference), raster: rectangle(canvas),
    pixi: rectangle(kernelHost) };
}
Object.defineProperty(window, 'prepareCanvasVisualProbe', { value: prepare });
