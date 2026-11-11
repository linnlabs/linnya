import './previewTimingRenderer';
import '@linnya/renderer-ui/tokens.css';
import '@linnya/document-preview/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/features/cardRendering/styles/canvasMediaContent.css';
import { createDocumentPreviewSurface, disposeDocumentPreviewSurface } from '@linnya/document-preview';
import { CanvasRenderRequestSchema } from '../../src/shared/rendering';
import { readCanvasCardCssPalette } from '../../src/shared';
import { createCanvasCardContent } from '../../src/renderer/features/cardMedia/orchestration/createCanvasCardContent';
import { collectVisualTextLayout } from './visualOracle/collectVisualTextLayout';
import { createCardSurface } from '../../src/renderer/hidden-render-worker/functions/createCardSurface';
import { createHtmlCardRasterizer } from '../../src/renderer/capabilities/textRasterization';
import { previewParityCard, previewParityFixture } from './previewParityFixture';

function frame(): Promise<void> { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function facts(element: HTMLElement) {
  const origin = element.getBoundingClientRect();
  const rectangle = (node: Element) => {
    const bounds = node.getBoundingClientRect();
    return [bounds.x - origin.x, bounds.y - origin.y, bounds.width, bounds.height];
  };
  const layout = collectVisualTextLayout(element, getComputedStyle(document.body).backgroundColor);
  const bodyBottom = element.querySelector('.workspace-markdown-preview')?.getBoundingClientRect().bottom ?? origin.bottom;
  const clipBottom = Math.min(origin.bottom, bodyBottom) - origin.top;
  // DOM Range 仍会返回被 overflow 裁掉的行；仅把完整可见字簇交给既有逐字 oracle，交界残片由非文字像素检查覆盖。
  layout.graphemes = layout.graphemes.filter(item => item.rects.every(rect => rect.y >= 0 && rect.y + rect.height <= clipBottom));
  const visibleIds = new Set(layout.graphemes.map(item => item.id));
  layout.lines = layout.lines.filter(line => line.graphemeIds.every(id => visibleIds.has(id)));
  return {
    text: element.textContent, dpr: devicePixelRatio,
    layout,
    blocks: Array.from(element.querySelectorAll<HTMLElement>('.document-preview-title,.workspace-preview-block,.workspace-preview-bibliography li'), node => {
      const style = getComputedStyle(node), child = node.querySelector<HTMLElement>('.editor-block') ?? node, childStyle = getComputedStyle(child);
      return { text: node.textContent, rect: rectangle(node), style: [style.font, style.color, style.margin, style.padding],
        childStyle: [childStyle.font, childStyle.color, childStyle.lineHeight, childStyle.whiteSpace], childRect: rectangle(child) };
    }),
    images: Array.from(element.querySelectorAll('img'), node => ({ rect: rectangle(node), width: node.naturalWidth, height: node.naturalHeight, decoded: node.complete && node.naturalWidth > 0 })),
    math: element.querySelectorAll('.katex').length,
    clipped: element.querySelector('.workspace-markdown-preview')?.getAttribute('data-preview-clipped') ?? null,
    bodyHeight: element.querySelector('.workspace-markdown-preview')?.getBoundingClientRect().height ?? 0,
  };
}
async function prepare(theme: 'light' | 'dark', width: number, firstScreen: boolean, route: 'tag' | 'canvas' | 'worker') {
  document.body.replaceChildren(); document.documentElement.setAttribute('data-linnya-ui-theme', theme);
  const palette = readCanvasCardCssPalette('white', theme === 'dark'), height = firstScreen ? 320 : 1500;
  // 淡出的底色和内缩由消费方提供；tag 基准和画布路线放在同一张纸上比较。
  document.body.style.cssText = `margin:0;background:${palette.paper};color:${palette.body};width:${width}px;height:${height}px;overflow:hidden;--document-preview-fade-color:${palette.paper};--document-preview-fade-radius:6px`;
  const preview = previewParityFixture(document), card = previewParityCard(width, height), controller = new AbortController();
  let element: HTMLElement, cleanup = () => {};
  if (route === 'tag') {
    const result = await createDocumentPreviewSurface({ preview, document, widthPx: width, ...(firstScreen ? { maxHeight: height, visibleInsetPx: 3 } : {}), theme, signal: controller.signal, onOpen: () => {} });
    element = result.element; cleanup = result.dispose;
  } else if (route === 'canvas') {
    const content = createCanvasCardContent('canvas-probe', {
      preview: async () => preview,
      readImage: async () => { throw new Error('unexpected_raw_asset_access'); },
      reference: async () => ({ documentId: preview.documentId, status: 'available', nodeType: 'document', title: preview.title, path: '/probe.md' }),
      subscribe: () => () => {}, subscribeAvailability: () => () => {}, projectId: () => 'project-probe', openDocument: async () => {},
    });
    element = await content.create(card, controller.signal);
    cleanup = () => { disposeDocumentPreviewSurface(element); content.dispose(); };
  } else {
    const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'preview-parity', kind: 'render', theme, material: 'paper',
      fontFamily: 'system-ui', fontSize: 14, dpr: devicePixelRatio, width, height, region: null, quality: 1, format: 'png',
      snapshot: { schemaVersion: 1, documentId: 'canvas-probe', sequence: 1, elements: [card] }, assets: {},
      documents: { [preview.documentId]: { title: preview.title, status: 'available', previewStatus: 'ready', body: preview.content?.detail } } });
    element = await createCardSurface(card, request, controller.signal);
    cleanup = () => disposeDocumentPreviewSurface(element);
  }
  document.body.append(element); await document.fonts.ready; await frame();
  const observed = facts(element);
  if (route === 'worker') {
    const staging = document.createElement('div'); document.body.append(staging);
    const rasterizer = createHtmlCardRasterizer({ host: staging });
    const raster = await rasterizer.rasterize({ element, width, height, scale: devicePixelRatio });
    const canvas = document.createElement('canvas'); canvas.width = raster.bitmap.width; canvas.height = raster.bitmap.height;
    canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
    const context = canvas.getContext('2d'); if (!context) throw new Error('preview_parity_output_context_missing');
    context.drawImage(raster.bitmap, 0, 0); raster.bitmap.close(); rasterizer.dispose(); staging.remove(); cleanup();
    document.body.replaceChildren(canvas);
  }
  await frame();
  Object.defineProperty(window, 'disposePreviewParity', { configurable: true, value: () => { cleanup(); controller.abort(); document.body.replaceChildren(); } });
  return { ...observed, width, height, theme, firstScreen, route };
}
Object.defineProperty(window, 'preparePreviewParity', { value: prepare });
