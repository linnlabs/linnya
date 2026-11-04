import { CanvasCardSchema, type CanvasCard } from '../../src/shared';
import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/styles/canvas.css';

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const source = { kind: 'agent', conversationId: 'visible-update-probe', runId: 'diagnostic' };
const appearance = { dark: false, material: 'paper', overview: 'titles' } as const;
let cards: CanvasCard[] = [], dispose = () => {};
const paints: number[] = [];
document.addEventListener('paint', () => paints.push(performance.now()), true);
let apply: ((poll: boolean, animate: boolean) => Promise<unknown>) | undefined;

async function prepare() {
  dispose(); document.body.replaceChildren(); document.body.style.cssText = 'margin:0;font-family:system-ui';
  const host = document.createElement('div'), staging = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0'; document.body.append(host, staging);
  const kernel = await createPixiCanvasKernel({ host, resolution: devicePixelRatio });
  const failures: string[] = [], raster = createCanvasRasterPresentation({ host: staging, kernel, suspendWhenHidden: false,
    readAppearance: () => appearance, reportFailure: message => failures.push(message) });
  cards = Array.from({ length: 500 }, (_, i) => CanvasCardSchema.parse({ id: `c${i + 1}`, type: 'text', schemaVersion: 1, revision: 1,
    order: String(i).padStart(6, '0'), x: i % 25 * 104, y: Math.floor(i / 25) * 88, width: 88, height: 72,
    locked: false, color: 'white', parentId: null, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `卡 ${String(i + 1).padStart(3, '0')}` }] }] } } }));
  const ids = cards.map(card => card.id);
  const settle = async (poll: boolean) => {
    const started = performance.now(); let polls = 0;
    for (;;) {
      await nextFrame(); if (poll) { raster.readReadiness(ids); polls++; }
      const stats = raster.readStats(); if (stats.failed || performance.now() - started > 10000) throw new Error(`visible_update_did_not_settle:${JSON.stringify({ stats, failures })}`);
      if (!stats.running && !stats.pending) {
        await nextFrame(); const readiness = raster.readReadiness(ids);
        if (readiness.complete) return { polls, readiness };
      }
    }
  };
  kernel.setElements(cards); kernel.fit(cards); raster.refresh(); await settle(false);
  apply = async (poll, animate) => {
    paints.length = 0;
    const started = performance.now(), previousDraw = kernel.readStats().renders;
    cards = cards.map(card => ({ ...card, revision: card.revision + 1, color: card.color === 'green' ? 'orange' : 'green' }));
    kernel.setElements(cards, animate ? { animateIds: ids } : {}); raster.refresh(); const projected = performance.now();
    await nextFrame(); const geometry = performance.now(); const settled = await settle(poll);
    const readiness = settled.readiness;
    if (kernel.readStats().renders <= previousDraw || readiness.cards.length !== 500 || readiness.cards.some(card => card.mode !== 'body' || card.status !== 'ready')) throw new Error('visible_update_body_not_drawn');
    return { measurement: 'kernel-input-to-current-body-draw', backendMeasured: false, validHardwareRun: false,
      cards: cards.length, poll, animate, polls: settled.polls, projectMs: projected - started, geometryMs: geometry - started,
      bodyMs: performance.now() - started, paints: paints.map(time => time - started), scene: kernel.readStats(), queue: raster.readStats(), failures };
  };
  dispose = () => { raster.dispose(); kernel.destroy(); apply = undefined; };
  return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, camera: kernel.readCamera(), scene: kernel.readStats(), queue: raster.readStats() };
}
Object.defineProperties(window, {
  prepareVisibleUpdateProbe: { value: prepare },
  updateVisibleUpdateProbe: { value: (poll: boolean, animate = false) => { if (!apply) throw new Error('visible_update_not_prepared'); return apply(poll, animate); } },
});
