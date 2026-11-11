import '@linnya/renderer-ui/tokens.css';
import '@linnya/document-preview/style.css';
import { CanvasCardSchema, type CanvasCard } from '../../src/shared';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/features/cardRendering/styles/canvasMediaContent.css';
import '../../src/renderer/styles/canvas.css';

let kernel: CanvasKernel | null = null;
let raster: ReturnType<typeof createCanvasRasterPresentation> | null = null;
let card: CanvasCard | null = null;
const failures: string[] = [];
function state() {
  if (!kernel || !raster || !card) throw new Error('visibility_fixture_not_prepared');
  return { visibility: document.visibilityState, revision: card.revision, queue: raster.readStats(), scene: kernel.readStats(), failures };
}
async function prepare() {
  document.body.style.cssText = 'margin:0;font-family:system-ui';
  const host = document.createElement('div'), staging = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0'; staging.className = 'canvas-raster-staging'; document.body.append(host, staging);
  const source = { kind: 'user', conversationId: null, runId: null };
  card = CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 30, y: 30, width: 360, height: 200, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '隐藏前的正文' }] }] } } });
  kernel = await createPixiCanvasKernel({ host }); kernel.setElements([card]);
  raster = createCanvasRasterPresentation({ host: staging, kernel, readAppearance: () => ({ dark: false, material: 'paper', overview: 'titles' }), reportFailure: error => failures.push(error) });
  raster.refresh(); return state();
}
function replaceWhileHidden() {
  if (!kernel || !raster || !card || card.type !== 'text' || document.visibilityState !== 'hidden') throw new Error('visibility_fixture_not_hidden');
  const next = CanvasCardSchema.parse({ ...card, revision: 2, data: { ...card.data, content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 },
    content: [{ type: 'text', text: '隐藏期间的新正文' }] }, { type: 'paragraph', content: [{ type: 'text', text: '恢复后必须显示当前内容，不接纳旧绘图。' }] }] } } });
  card = next; kernel.setElements([next]); raster.refresh(); return state();
}
async function settle() {
  const started = performance.now();
  while (performance.now() - started < 5000) {
    const current = state();
    if (current.failures.length) throw new Error(`visibility_raster_failure:${current.failures.join(',')}`);
    if (!current.queue.pending && !current.queue.running && current.scene.bitmaps) return current;
    await new Promise<void>(resolve => setTimeout(resolve, 16));
  }
  throw new Error('visibility_resume_did_not_settle');
}
async function freshReference() {
  if (!kernel || !raster) throw new Error('visibility_fixture_not_prepared');
  kernel.invalidateBitmaps(); raster.retry(); await settle(); return kernel.captureImage('png');
}
Object.defineProperties(window, { prepareCanvasVisibilityProbe: { value: prepare }, readCanvasVisibilityProbe: { value: state },
  changeHiddenCanvasVisibilityProbe: { value: replaceWhileHidden }, settleCanvasVisibilityProbe: { value: settle },
  captureCanvasVisibilityProbe: { value: () => kernel?.captureImage('png') }, freshCanvasVisibilityProbe: { value: freshReference } });
