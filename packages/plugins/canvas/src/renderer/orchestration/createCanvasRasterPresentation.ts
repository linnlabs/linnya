import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import { cardRasterKey, createHtmlCardRasterizer, createLatestRasterQueue, splitCardRasterRegions,
  type RasterQueueResult } from '../capabilities/textRasterization';
import { createCanvasCardRasterBatch, type CanvasCardRasterInput, type CanvasCardRasterOutput } from '../features/cardRendering';
import type { CanvasRasterDemand, CanvasRasterIdentity, CanvasRasterFrame, CanvasRasterPending, CanvasRasterPresentationOptions } from '../definitions/canvasRasterPresentation';

/** 可见内容的派生投影；正文/相机/主题都由各owner提供，不另存一份正文。 */
export function createCanvasRasterPresentation(options: CanvasRasterPresentationOptions) { return new CanvasRasterPresentation(options); }

class CanvasRasterPresentation {
  private readonly rasterizer;
  private readonly queue;
  private readonly pending = new Map<CanvasCardId, CanvasRasterPending>();
  private readonly preparingEdits = new Map<CanvasCardId, Promise<'ready' | 'unavailable'>>();
  private readonly failed = new Map<CanvasCardId, string>();
  private readonly descriptors = new WeakMap<CanvasCard, string>();
  private disposed = false;
  private pump = false;
  private refreshes = 0;
  private maximumRefreshMs = 0;
  private requestedTiles = 0;
  private requestedPixels = 0;
  private subPixelTiles = 0;
  private cameraKey = '';
  private cameraChangedAt = 0;
  private precisionTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly visibilityChanged = () => {
    if (this.suspended()) { this.cancelPending(); clearTimeout(this.precisionTimer); }
    else this.refresh();
  };
  constructor(private readonly options: CanvasRasterPresentationOptions) {
    this.rasterizer = createHtmlCardRasterizer({ host: options.host });
    this.queue = createLatestRasterQueue<CanvasCardRasterInput, CanvasCardRasterOutput>({
      batchSize: 32, executeBatch: createCanvasCardRasterBatch({ rasterizer: this.rasterizer, createContent: options.createContent }),
      disposeResult: output => { if (output.kind === 'ready') for (const tile of output.tiles) tile.bitmap.close(); },
    });
    options.host.ownerDocument.addEventListener('visibilitychange', this.visibilityChanged);
  }
  private suspended(): boolean { return this.options.suspendWhenHidden !== false && this.options.host.ownerDocument.visibilityState === 'hidden'; }
  private cancelPending(): void { for (const id of this.pending.keys()) this.queue.cancel(id); this.pending.clear(); }
  private descriptor(card: CanvasCard): string {
    const existing = this.descriptors.get(card);
    if (existing) return existing;
    // 移动递增revision但不改变正文；染纸改变深墨，因此颜色必须入键。
    const value = JSON.stringify([card.type, card.width, card.height, card.color, card.data]);
    this.descriptors.set(card, value); return value;
  }
  private schedule(): void {
    if (this.pump || this.disposed) return;
    // 补图准备是有界工作批次，不进入纯绘制RAF闭包；同批Promise回执合并一次需求刷新。
    this.pump = true; queueMicrotask(() => { this.pump = false; this.refresh(); });
  }
  private identity(card: CanvasCard, frame: CanvasRasterFrame): CanvasRasterIdentity {
    const camera = this.options.kernel.readCamera(), pixelRatio = this.options.kernel.readResolution();
    const appearance = this.options.readAppearance();
    const screenWidth = card.width * camera.zoom * pixelRatio;
    const precise = frame.precise ?? (camera.zoom >= 0.75 && frame.count <= 40 && performance.now() - this.cameraChangedAt >= 100);
    const physicalWidth = precise ? screenWidth : screenWidth <= 140 ? 70 : screenWidth <= 280 ? 280 : screenWidth <= 560 ? 560 : 1120;
    const scale = physicalWidth / card.width, content = this.descriptor(card), externalKey = this.options.readContentKey?.(card) ?? '';
    const key = cardRasterKey({ revision: 0, theme: appearance.dark ? 'dark' : 'light', dpr: pixelRatio,
      material: 'body', lod: 0, font: `${frame.font}/14/1.7`, uiScale: 1 }) + content + externalKey + (precise ? JSON.stringify(['exact', physicalWidth]) : 'bucket');
    return { card, key, content, externalKey, scale, precise, dark: appearance.dark, physicalWidth };
  }
  private demand(card: CanvasCard, frame: CanvasRasterFrame): CanvasRasterDemand {
    const identity = this.identity(card, frame), { key, scale, precise, physicalWidth } = identity;
    const regions = splitCardRasterRegions(this.options.kernel.readMissingBitmapRegions(card.id, key,
      this.options.kernel.readVisibleCardRegions(card.id), { scale, exact: precise }), scale);
    return { ...identity, jobKey: key + physicalWidth + JSON.stringify(regions), regions };
  }
  private accept(demand: CanvasRasterDemand): boolean {
    const pending = this.pending.get(demand.card.id);
    if (this.failed.get(demand.card.id) === demand.key || !demand.regions.length) return false;
    // 相机/遮挡改变的是需求区域，不是卡内正文。保留同内容同采样的在途片，
    // 接纳后只补最新缺片；否则每个pointer都会丢弃仍正确的paint结果并重复排版。
    if (pending?.contentKey === demand.key && pending.scale === demand.scale) return false;
    if (this.pending.has(demand.card.id)) { this.queue.cancel(demand.card.id); this.pending.delete(demand.card.id); }
    return true;
  }
  private enqueue(demand: CanvasRasterDemand): Promise<boolean> {
    for (const region of demand.regions) {
      this.requestedTiles++; this.requestedPixels += Math.ceil(region.width * demand.scale) * Math.ceil(region.height * demand.scale);
      if (Math.min(region.width, region.height) * demand.scale < 0.001) this.subPixelTiles++;
    }
    const completion: Promise<boolean> = this.queue.enqueue(demand.card.id, { card: demand.card, scale: demand.scale, dark: demand.dark, regions: demand.regions })
      .then(result => this.complete(demand, result, job));
    const job: CanvasRasterPending = { key: demand.jobKey, contentKey: demand.key, scale: demand.scale, completion }; this.pending.set(demand.card.id, job);
    return completion;
  }
  private complete(demand: CanvasRasterDemand, result: RasterQueueResult<CanvasCardRasterOutput>, job: CanvasRasterPending): boolean {
    let installed = false;
    if (this.pending.get(demand.card.id) === job) this.pending.delete(demand.card.id);
    if (result.status === 'ready' && result.value.kind === 'ready') {
      const current = this.options.kernel.readCard(demand.card.id);
      if (current && this.options.kernel.readVisibleCardRegions(current.id).length && this.identity(current, { count: 1, font: this.fontKey(), precise: demand.precise }).key === demand.key) {
        installed = this.options.kernel.setRasterTiles(current.id, current.revision, demand.key, result.value.tiles);
      } else for (const tile of result.value.tiles) tile.bitmap.close();
    } else if (result.status === 'failed') this.fail(demand, result.error);
    else if (result.status === 'ready' && result.value.kind === 'failed') this.fail(demand, result.value.error);
    if (result.status === 'ready') this.schedule();
    return installed;
  }
  private fail(demand: CanvasRasterDemand, error: unknown): void {
    this.failed.set(demand.card.id, demand.key); this.options.reportFailure(error instanceof Error ? error.message : String(error));
  }
  refresh(): void {
    if (this.disposed || this.suspended()) return;
    const started = performance.now(), camera = this.options.kernel.readCamera();
    const nextCameraKey = `${camera.x}:${camera.y}:${camera.zoom}:${this.options.kernel.readResolution()}`;
    if (nextCameraKey !== this.cameraKey) {
      this.cameraKey = nextCameraKey; this.cameraChangedAt = performance.now(); clearTimeout(this.precisionTimer);
      this.precisionTimer = setTimeout(() => { this.precisionTimer = undefined; this.refresh(); }, 100);
    }
    const visible = this.options.kernel.rasterCards(), ids = new Set(visible.map(card => card.id));
    for (const id of this.pending.keys()) if (!ids.has(id) && !this.preparingEdits.has(id)) { this.queue.cancel(id); this.pending.delete(id); }
    const font = this.fontKey();
    const prioritized = visible.map(card => ({ card, area: this.options.kernel.readVisibleCardRegions(card.id).reduce((sum, region) => sum + region.width * region.height, 0) }))
      .sort((a, b) => b.area - a.area);
    for (const { card } of prioritized) {
      if (this.preparingEdits.has(card.id)) continue;
      const demand = this.demand(card, { count: visible.length, font });
      if (!this.accept(demand)) continue;
      // 不能把几百张可见卡反复冲入64槽队列；完成一个任务后再补下一张。
      if (this.pending.size >= 65) break;
      void this.enqueue(demand);
    }
    this.refreshes++; this.maximumRefreshMs = Math.max(this.maximumRefreshMs, performance.now() - started);
  }
  private fontKey(): string {
    const style = getComputedStyle(this.options.host);
    return `${style.fontFamily}/${style.getPropertyValue('-webkit-font-smoothing')}`;
  }
  prepareEditing(id: CanvasCardId): Promise<'ready' | 'unavailable'> {
    const existing = this.preparingEdits.get(id); if (existing) return existing;
    const preparation = this.prepareExact(id); this.preparingEdits.set(id, preparation);
    const release = () => { if (this.preparingEdits.get(id) === preparation) this.preparingEdits.delete(id); };
    void preparation.then(release, release); return preparation;
  }
  private async prepareExact(id: CanvasCardId): Promise<'ready' | 'unavailable'> {
    if (this.disposed || this.suspended()) return 'unavailable';
    const card = this.options.kernel.readCard(id);
    if (!card || !this.options.kernel.readVisibleCardRegions(id).length) return 'unavailable';
    const demand = this.demand(card, { count: 1, font: this.fontKey(), precise: true });
    if (!demand.regions.length) return 'ready';
    if (this.failed.get(id) === demand.key) return 'unavailable';
    const existing = this.pending.get(id);
    if (existing?.key === demand.jobKey) return await existing.completion ? 'ready' : 'unavailable';
    if (existing) { this.queue.cancel(id); this.pending.delete(id); }
    // 单卡进入编辑优先于远处补图，但仍保留同一全局有界队列和结果所有权。
    if (this.pending.size >= 65) { const first = this.pending.keys().next(); if (!first.done) { this.queue.cancel(first.value); this.pending.delete(first.value); } }
    return await this.enqueue(demand) ? 'ready' : 'unavailable';
  }
  retry(): void { this.failed.clear(); this.refresh(); }
  readStats() { return { ...this.queue.readStats(), failed: this.failed.size, refreshes: this.refreshes,
    maximumRefreshMs: this.maximumRefreshMs, requestedTiles: this.requestedTiles, requestedPixels: this.requestedPixels, subPixelTiles: this.subPixelTiles }; }
  dispose(): void {
    this.disposed = true; clearTimeout(this.precisionTimer); this.cancelPending();
    this.options.host.ownerDocument.removeEventListener('visibilitychange', this.visibilityChanged);
    this.queue.dispose(); this.rasterizer.dispose();
  }
}
