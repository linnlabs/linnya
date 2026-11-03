import { AlphaFilter, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { readCanvasLinePalette } from '../../../../shared';
import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasEdge, CanvasEdgeId, CanvasPoint, CanvasRectangle } from '../../../../shared';
import type { CanvasAppearance } from '../../definitions/canvasKernel';
import { createCanvasEdgeLayout, type CanvasEdgeGeometry } from '../../geometry/canvasEdgeGeometry';
import { CanvasLineMesh } from './CanvasLineMesh';

interface Entry { readonly edge: CanvasEdge; readonly geometry: CanvasEdgeGeometry; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
function entryFor(edge: CanvasEdge, geometry: CanvasEdgeGeometry): Entry {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of geometry.points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
  return { edge, geometry, left, right, top, bottom };
}
const blend = (ink: number, background: number, amount: number) => {
  const channel = (shift: number) => Math.round((ink >> shift & 255) * amount + (background >> shift & 255) * (1 - amount));
  return channel(16) << 16 | channel(8) << 8 | channel(0);
};
/** 静态世界几何与相机uniform分离；卡片上方的淡影与底线共用同一GPU几何。 */
export class CanvasLines {
  readonly below = new Container();
  readonly above = new Container();
  private readonly base = new CanvasLineMesh();
  private readonly ghost = new CanvasLineMesh();
  private readonly movingBase = new CanvasLineMesh();
  private readonly movingGhost = new CanvasLineMesh();
  private readonly highlight = new CanvasLineMesh();
  private readonly selectedLine = new CanvasLineMesh();
  private readonly ghostContainer = new Container();
  private readonly ghostAlpha = new AlphaFilter({ alpha: 0.22 * 0.42 });
  private readonly ghostArea = new Rectangle(0, 0, 1, 1);
  private readonly cardMask = new Graphics();
  private readonly endpoints = new Graphics();
  private readonly labelCanvas = document.createElement('canvas');
  private readonly labelTexture = Texture.from(this.labelCanvas);
  private readonly labels = new Sprite(this.labelTexture);
  private geometries: ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> = new Map();
  private layout: ReturnType<typeof createCanvasEdgeLayout> | undefined;
  private previewIds: ReadonlySet<CanvasEdgeId> | undefined;
  private movingDirty = false;
  private previewState: { readonly cardIds: readonly CanvasCardId[]; readonly cards: ReadonlyMap<string, CanvasCard> } | undefined;
  private entries: readonly Entry[] = [];
  private selected: CanvasEdgeId | null = null;
  private selectedCards = new Set<CanvasCardId>();
  private hovered: CanvasCardId | null = null;
  private camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  private appearance: CanvasAppearance = { dark: false, material: 'paper', overview: 'titles' };
  private width = 1;
  private height = 1;
  private resolution = 1;
  private far = false;
  private reduced = false;
  private key = '';
  private emphasisKey = '';
  private builds = 0;
  private visibleCount = 0;
  private farEntries: readonly Entry[] = [];
  constructor() {
    this.below.addChild(this.base.mesh, this.movingBase.mesh);
    this.ghostContainer.addChild(this.ghost.mesh, this.movingGhost.mesh); this.ghostContainer.mask = this.cardMask;
    // 整层合成后再淡化：交叉处不累加墨色，也不能用不透明浅色覆盖正文笔画。
    this.ghostContainer.filters = [this.ghostAlpha]; this.ghostContainer.filterArea = this.ghostArea;
    this.above.addChild(this.cardMask, this.ghostContainer, this.highlight.mesh, this.selectedLine.mesh, this.labels, this.endpoints);
  }
  setElements(edges: readonly CanvasEdge[], cards: ReadonlyMap<string, CanvasCard>, mask: readonly CanvasRectangle[]): void {
    this.previewIds = undefined; this.previewState = undefined;
    this.layout = createCanvasEdgeLayout(edges, cards, 4, this.geometries); this.geometries = this.layout.read();
    this.entries = edges.map(edge => {
      const geometry = this.geometries.get(edge.id);
      if (!geometry) throw new Error('canvas_edge_geometry_missing');
      return entryFor(edge, geometry);
    });
    this.farEntries = this.entries.map(entry => ({ ...entry, geometry: { ...entry.geometry,
      points: [entry.geometry.from, entry.geometry.to], midpoint: { x: (entry.geometry.from.x + entry.geometry.to.x) / 2, y: (entry.geometry.from.y + entry.geometry.to.y) / 2 } } }));
    this.base.clearCache();
    this.movingBase.setGeometry([]); this.movingGhost.shareGeometry(this.movingBase);
    this.setMask(mask);
    this.key = ''; this.emphasisKey = ''; this.update();
  }
  setMask(mask: readonly CanvasRectangle[]): void {
    this.cardMask.clear();
    for (const region of mask) this.cardMask.rect(region.x, region.y, region.width, region.height);
    this.cardMask.fill(0xffffff);
  }
  preview(cardIds: readonly CanvasCardId[], cards: ReadonlyMap<string, CanvasCard>, mask: readonly CanvasRectangle[]): void {
    if (!this.layout) return;
    if (!this.previewIds) {
      // 邻卡的同侧连接也可能重新排开；这些线独立于不变的世界线层，不能每个pointer重建全图。
      const movedCards = new Set<string>(cardIds), affectedCards = new Set<string>(cardIds);
      for (const entry of this.entries) if ([entry.edge.from, entry.edge.to].some(endpoint => endpoint.kind === 'card' && movedCards.has(endpoint.cardId))) {
        for (const endpoint of [entry.edge.from, entry.edge.to]) if (endpoint.kind === 'card') affectedCards.add(endpoint.cardId);
      }
      this.previewIds = new Set(this.entries.filter(entry => [entry.edge.from, entry.edge.to].some(endpoint => endpoint.kind === 'card' && affectedCards.has(endpoint.cardId))).map(entry => entry.edge.id));
      this.key = '';
    }
    this.previewState = { cardIds, cards }; this.refreshPreviewGeometry(); this.setMask(mask); this.update();
  }
  private refreshPreviewGeometry(): void {
    if (!this.layout || !this.previewState) return;
    const { cards, cardIds } = this.previewState;
    // 静态缓存覆盖最大倍率；拖动只需保持当前相机的1/4屏幕px误差，不能一律按4倍细分。
    const changed = new Set(this.layout.update(cards, cardIds, this.camera.zoom));
    this.entries = this.entries.map(entry => {
      if (!changed.has(entry.edge.id)) return entry;
      const geometry = this.geometries.get(entry.edge.id); if (!geometry) throw new Error('canvas_edge_geometry_missing');
      return entryFor(entry.edge, geometry);
    });
    this.farEntries = this.farEntries.map((entry, index) => {
      if (!changed.has(entry.edge.id)) return entry;
      const current = this.entries[index];
      return { ...current, geometry: { ...current.geometry, points: [current.geometry.from, current.geometry.to], midpoint: { x: (current.geometry.from.x + current.geometry.to.x) / 2, y: (current.geometry.from.y + current.geometry.to.y) / 2 } } };
    });
    this.movingDirty = true; this.emphasisKey = '';
  }
  setCamera(camera: CanvasCamera, width: number, height: number, resolution: number): void {
    const zoomChanged = this.camera.zoom !== camera.zoom;
    this.camera = camera; this.width = width; this.height = height; this.resolution = resolution;
    if (this.previewIds) { if (zoomChanged) this.refreshPreviewGeometry(); this.movingDirty = true; }
    const far = camera.zoom < 0.15;
    if (far !== this.far) { this.far = far; this.key = ''; }
    this.update();
  }
  setAppearance(appearance: CanvasAppearance): void { this.appearance = appearance; this.update(); }
  setReduced(reduced: boolean): void { this.reduced = reduced; this.update(); }
  setSelection(cards: readonly CanvasCardId[]): void { this.selectedCards = new Set(cards); this.update(); }
  setSelected(id: CanvasEdgeId | null): void { this.selected = id; this.update(); }
  setHovered(id: CanvasCardId | null): void { if (this.hovered === id) return; this.hovered = id; this.update(); }
  readGeometry(id: CanvasEdgeId): CanvasEdgeGeometry | null { return this.far ? this.farEntries.find(entry => entry.edge.id === id)?.geometry ?? null : this.geometries.get(id) ?? null; }
  private emphasized(edge: CanvasEdge): boolean {
    return [edge.from, edge.to].some(endpoint => endpoint.kind === 'card' && (this.selectedCards.has(endpoint.cardId) || endpoint.cardId === this.hovered));
  }
  private update(): void {
    const { x, y, zoom } = this.camera;
    const entries = this.far ? this.farEntries : this.entries;
    const visible = entries.filter(entry => entry.left * zoom + x <= this.width && entry.right * zoom + x >= 0
      && entry.top * zoom + y <= this.height && entry.bottom * zoom + y >= 0);
    this.visibleCount = visible.length;
    const allowed = visible.length > 3000 ? visible.filter(entry => this.emphasized(entry.edge) || entry.edge.id === this.selected) : entries.length > 3000 ? visible : entries;
    this.updateMeshes(allowed, visible);
    this.updateAppearance();
    this.drawEndpoints(); this.drawLabels(visible);
  }
  private updateMeshes(allowed: readonly Entry[], visible: readonly Entry[]): void {
    const entries = this.far ? this.farEntries : this.entries;
    const stationary = this.previewIds ? allowed.filter(entry => !this.previewIds?.has(entry.edge.id)) : allowed;
    const key = `${this.far}:${stationary.map(entry => entry.edge.id).join(',')}`;
    if (key !== this.key) {
      this.base.setGeometry(stationary, entries.length <= 3000 && !this.previewIds ? `${this.far}` : undefined); this.ghost.shareGeometry(this.base);
      this.key = key; this.builds++;
    }
    if (this.previewIds && this.movingDirty) { this.movingBase.setGeometry((visible.length > 3000 ? allowed : visible).filter(entry => this.previewIds?.has(entry.edge.id))); this.movingGhost.shareGeometry(this.movingBase); this.movingDirty = false; }
    const emphasized = visible.filter(entry => this.emphasized(entry.edge));
    const emphasisKey = `${this.far}:${emphasized.map(entry => entry.edge.id).join(',')}:${this.selected}`;
    if (emphasisKey !== this.emphasisKey) { this.highlight.setGeometry(emphasized); this.selectedLine.setGeometry(allowed.filter(entry => entry.edge.id === this.selected)); this.emphasisKey = emphasisKey; }
  }
  private updateAppearance(): void {
    const { x, y, zoom } = this.camera;
    const background = this.appearance.dark ? 0x222723 : 0xf2f3ee, ink = this.appearance.dark ? 0xe8e9e3 : 0x252c27;
    const amount = zoom < 0.15 ? 0.1 : zoom < 0.3 ? 0.16 : 0.22;
    const palette = readCanvasLinePalette(this.appearance.dark);
    this.base.setColor(blend(ink, background, amount), 1, palette);
    this.movingBase.setColor(blend(ink, background, amount), 1, palette);
    this.ghost.setColor(ink, 1, palette); this.movingGhost.setColor(ink, 1, palette);
    this.highlight.setColor(blend(ink, background, 0.55), 1.25, palette); this.selectedLine.setColor(0x347b45, 1.5);
    for (const layer of [this.base, this.ghost, this.movingBase, this.movingGhost, this.highlight, this.selectedLine]) layer.setCamera(this.camera, this.resolution);
    this.cardMask.position.set(x, y); this.cardMask.scale.set(zoom);
    this.ghostArea.width = this.width; this.ghostArea.height = this.height;
    this.below.visible = !this.reduced || zoom >= 0.3;
    this.ghostContainer.visible = !this.reduced && zoom >= 0.3;
  }
  private drawEndpoints(): void {
    this.endpoints.clear();
    const geometry = this.selected ? this.geometries.get(this.selected) : undefined;
    if (!geometry) return;
    for (const point of [geometry.from, geometry.to]) this.endpoints.circle(point.x * this.camera.zoom + this.camera.x,
      point.y * this.camera.zoom + this.camera.y, 3.5).fill(0x347b45).stroke({ width: 1, color: 0xffffff });
  }
  private drawLabels(visible: readonly Entry[]): void {
    const labeled = visible.filter(entry => entry.edge.label);
    this.labels.visible = labeled.length > 0;
    if (!labeled.length) return;
    this.labelCanvas.width = Math.ceil(this.width * this.resolution); this.labelCanvas.height = Math.ceil(this.height * this.resolution);
    const context = this.labelCanvas.getContext('2d');
    if (!context) throw new Error('canvas_line_labels_context_missing');
    context.scale(this.resolution, this.resolution); context.font = '12px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.strokeStyle = this.appearance.dark ? '#222723' : '#f2f3ee'; context.fillStyle = this.appearance.dark ? '#b5bcb3' : '#626b61'; context.lineWidth = 5;
    for (const entry of labeled) {
      let label = entry.edge.label;
      while (label.length > 1 && context.measureText(label).width > 200) label = label.slice(0, -2) + '…';
      const point = entry.geometry.midpoint, x = point.x * this.camera.zoom + this.camera.x, y = point.y * this.camera.zoom + this.camera.y;
      context.strokeText(label, x, y); context.fillText(label, x, y);
    }
    this.labelTexture.source.update(); this.labels.width = this.width; this.labels.height = this.height;
  }
  hitTest(point: CanvasPoint): CanvasEdge | null {
    const tolerance = 6 / this.camera.zoom;
    const entries = this.far ? this.farEntries : this.entries;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (point.x < entry.left - tolerance || point.x > entry.right + tolerance || point.y < entry.top - tolerance || point.y > entry.bottom + tolerance) continue;
      const { points } = entry.geometry;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
        if (Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= tolerance) return entry.edge;
      }
    }
    return null;
  }
  readStats() { return { lineMeshBuilds: this.builds, visibleEdges: this.visibleCount }; }
  destroy(): void {
    this.ghost.destroy(); this.movingGhost.destroy(); this.movingBase.destroy(); this.highlight.destroy(); this.selectedLine.destroy(); this.base.destroy(); this.labelTexture.destroy(true);
    this.below.destroy({ children: true }); this.above.destroy({ children: true });
    this.ghostAlpha.destroy();
  }
}
