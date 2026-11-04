import { CanvasSource, Rectangle, Sprite, Texture } from 'pixi.js';
import { withCanvasIdentityTextRaster } from './canvasIdentityTextRaster';

interface Binding { readonly sprite: Sprite; text: string; active: boolean; entry: Entry | null }
interface Entry { readonly key: string; readonly page: Page; readonly texture: Texture; readonly bindings: Set<Binding> }
interface Page {
  readonly canvas: HTMLCanvasElement; readonly context: CanvasRenderingContext2D; readonly source: CanvasSource;
  readonly entries: Set<Entry>; readonly resolution: number; readonly bytes: number;
  x: number; y: number; rowHeight: number; active: number;
}

export class CanvasIdentityAtlasCapacityError extends Error {
  constructor(readonly budgetBytes: number, readonly currentBytes: number, readonly requestedBytes: number) {
    super('canvas_identity_atlas_budget_exceeded'); this.name = 'CanvasIdentityAtlasCapacityError';
  }
}

/** 整串浏览器/Pixi排版、世界坐标Sprite；一页只有一个source和明确的末次释放。 */
export class CanvasIdentityAtlas {
  private readonly bindings = new Map<Sprite, Binding>();
  private readonly entries = new Map<string, Entry>();
  private readonly pages = new Set<Page>();
  private readonly pending = new Set<Binding>();
  private readonly dirty = new Set<Page>();
  private resolution: number | null = null;
  private bytes = 0;
  private uploads = 0;
  private readonly gutter = 2;
  constructor(private readonly options: {
    readonly budget: number;
    readonly reserve: (atlasBytes: number) => void;
  }) {}

  create(text: string): Sprite {
    const sprite = new Sprite(Texture.EMPTY);
    this.bindings.set(sprite, { sprite, text, active: false, entry: null });
    return sprite;
  }
  setText(sprite: Sprite, text: string): void {
    const binding = this.bindings.get(sprite); if (!binding || binding.text === text) return;
    this.release(binding); binding.text = text;
    if (binding.active) this.pending.add(binding);
  }
  setActive(sprite: Sprite, active: boolean): void {
    const binding = this.bindings.get(sprite); if (!binding || binding.active === active) return;
    binding.active = active;
    if (binding.entry) binding.entry.page.active += active ? 1 : -1;
    if (active) this.pending.add(binding);
    else this.pending.delete(binding);
  }
  remove(sprite: Sprite): void {
    const binding = this.bindings.get(sprite); if (!binding) return;
    this.release(binding); this.pending.delete(binding); this.bindings.delete(sprite);
  }
  private detach(binding: Binding): void {
    const entry = binding.entry; if (!entry) return;
    entry.bindings.delete(binding); if (binding.active) entry.page.active--;
    binding.entry = null; binding.sprite.texture = Texture.EMPTY;
  }
  private release(binding: Binding): void {
    const page = binding.entry?.page; this.detach(binding);
    // 隐藏的活视图仍可复用整页；最后一个视图离开后没有保留过往标题的理由。
    if (page && [...page.entries].every(entry => !entry.bindings.size)) this.destroyPage(page);
  }
  private touch(page: Page): void { this.pages.delete(page); this.pages.add(page); }
  private destroyPage(page: Page): void {
    this.pages.delete(page); this.bytes -= page.bytes;
    for (const entry of page.entries) {
      this.entries.delete(entry.key);
      for (const binding of [...entry.bindings]) this.detach(binding);
      entry.texture.destroy(false);
    }
    this.dirty.delete(page); page.source.destroy(); page.canvas.width = page.canvas.height = 0;
  }
  trimTo(bytes: number): void {
    for (const page of this.pages) {
      if (this.bytes <= bytes) break;
      if (!page.active) this.destroyPage(page);
    }
  }
  private createPage(width: number, height: number, resolution: number): Page {
    const pageWidth = Math.max(1024, width), pageHeight = Math.max(512, height), bytes = pageWidth * pageHeight * 4;
    this.trimTo(this.options.budget - bytes);
    if (this.bytes + bytes > this.options.budget) throw new CanvasIdentityAtlasCapacityError(this.options.budget, this.bytes, bytes);
    this.options.reserve(this.bytes + bytes);
    const canvas = document.createElement('canvas'); canvas.width = pageWidth; canvas.height = pageHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('canvas_2d_unavailable');
    const source = new CanvasSource({ resource: canvas, resolution, alphaMode: 'premultiply-alpha-on-upload' });
    const page: Page = { canvas, context, source, entries: new Set(), resolution, bytes, x: 0, y: 0, rowHeight: 0, active: 0 };
    this.bytes += bytes; this.pages.add(page); return page;
  }
  private position(width: number, height: number, resolution: number): { readonly page: Page; readonly x: number; readonly y: number } {
    const w = width + this.gutter * 2, h = height + this.gutter * 2;
    for (const page of [...this.pages].reverse()) {
      if (page.resolution !== resolution) continue;
      const x = page.x + w <= page.canvas.width ? page.x : 0, y = x ? page.y : page.y + page.rowHeight;
      if (x + w > page.canvas.width || y + h > page.canvas.height) continue;
      if (!x) { page.y = y; page.rowHeight = 0; }
      page.x = x + w; page.rowHeight = Math.max(page.rowHeight, h); this.touch(page);
      return { page, x: x + this.gutter, y: y + this.gutter };
    }
    const page = this.createPage(w, h, resolution);
    page.x = w; page.rowHeight = h;
    return { page, x: this.gutter, y: this.gutter };
  }
  private acquire(text: string, resolution: number): Entry {
    const key = JSON.stringify([resolution, text]), existing = this.entries.get(key);
    if (existing) { this.touch(existing.page); return existing; }
    return withCanvasIdentityTextRaster(text, resolution, raster => {
      const { page, x, y } = this.position(raster.width, raster.height, resolution);
      page.context.drawImage(raster.canvas, 0, 0, raster.width, raster.height, x, y, raster.width, raster.height);
      const frame = new Rectangle(x / resolution, y / resolution, raster.width / resolution, raster.height / resolution);
      const entry: Entry = { key, page, texture: new Texture({ source: page.source, frame }), bindings: new Set() };
      page.entries.add(entry); this.entries.set(key, entry); this.dirty.add(page); return entry;
    });
  }
  flush(resolution: number): void {
    if (this.resolution !== resolution) {
      this.resolution = resolution;
      for (const binding of this.bindings.values()) if (binding.active) {
        // DPR切换在同一准备批内替换，先解除旧页活动引用，避免临时双份挤破总预算。
        this.release(binding); this.pending.add(binding);
      }
    }
    if (!this.pending.size) return;
    // 所有准备均在输入/异步工作批中完成；纯绘制RAF只消费已准备的页。
    for (const binding of this.pending) {
      if (!binding.active) continue;
      const next = this.acquire(binding.text, resolution);
      if (binding.entry !== next) {
        this.release(binding); binding.entry = next; next.bindings.add(binding); next.page.active++;
        binding.sprite.texture = next.texture;
      }
    }
    this.pending.clear();
    for (const page of this.dirty) { page.source.update(); this.uploads++; }
    this.dirty.clear();
  }
  readBytes(): number { return this.bytes; }
  readStats() { return { identityPages: this.pages.size, identityEntries: this.entries.size,
    identityBytes: this.bytes, identityCanvasBytes: this.bytes, identityPageUpdates: this.uploads,
    identityActiveLabels: [...this.pages].reduce((sum, page) => sum + page.active, 0) }; }
  destroy(): void {
    for (const page of [...this.pages]) this.destroyPage(page);
    this.bindings.clear(); this.pending.clear(); this.dirty.clear();
  }
}
