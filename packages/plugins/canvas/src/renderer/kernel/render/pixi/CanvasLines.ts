import { AlphaFilter, Container, Graphics, Rectangle } from 'pixi.js';
import { readCanvasLinePalette } from '../../../../shared';
import type {
  CanvasCamera,
  CanvasCard,
  CanvasCardId,
  CanvasEdge,
  CanvasEdgeId,
  CanvasPoint,
  CanvasRectangle,
} from '../../../../shared';
import type { CanvasAppearance, CanvasChromeColors } from '../../definitions/canvasKernel';
import { canvasStandaloneChrome } from './canvasStandaloneChrome';
import { createCanvasEdgeLayout, type CanvasEdgeGeometry } from '../../geometry/canvasEdgeGeometry';
import { canvasFitLineLabel, CANVAS_LINE_LABEL_FONT } from '../../geometry/canvasLineLabelFit';
import { canvasLineLabelAnchor } from '../../geometry/canvasLineLabelAnchor';
import { CanvasLineMesh } from './CanvasLineMesh';
import { CanvasScreenTexture } from './CanvasScreenTexture';

interface Entry {
  readonly edge: CanvasEdge;
  readonly geometry: CanvasEdgeGeometry;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
function entryFor(edge: CanvasEdge, geometry: CanvasEdgeGeometry): Entry {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const point of geometry.points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { edge, geometry, left, right, top, bottom };
}
const blend = (ink: number, background: number, amount: number) => {
  const channel = (shift: number) =>
    Math.round(((ink >> shift) & 255) * amount + ((background >> shift) & 255) * (1 - amount));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
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
  private readonly labelLayer = new CanvasScreenTexture();
  private readonly labels = this.labelLayer.sprite;
  private geometries: ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> = new Map();
  private layout: ReturnType<typeof createCanvasEdgeLayout> | undefined;
  private previewIds: ReadonlySet<CanvasEdgeId> | undefined;
  private movingDirty = false;
  private previewState:
    | { readonly cardIds: readonly CanvasCardId[]; readonly cards: ReadonlyMap<string, CanvasCard> }
    | undefined;
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
  private maskRegions: readonly CanvasRectangle[] = [];
  /** 标签锚点只随几何与卡片遮挡变化；相机移动只重投影，不重复求交。 */
  private labelAnchors = new WeakMap<CanvasEdgeGeometry, CanvasPoint | null>();
  constructor() {
    this.below.addChild(this.base.mesh, this.movingBase.mesh);
    this.ghostContainer.addChild(this.ghost.mesh, this.movingGhost.mesh);
    this.ghostContainer.mask = this.cardMask;
    // 整层合成后再淡化：交叉处不累加墨色，也不能用不透明浅色覆盖正文笔画。
    this.ghostContainer.filters = [this.ghostAlpha];
    this.ghostContainer.filterArea = this.ghostArea;
    this.above.addChild(
      this.cardMask,
      this.ghostContainer,
      this.highlight.mesh,
      this.selectedLine.mesh,
      this.labels,
      this.endpoints
    );
  }
  setElements(
    edges: readonly CanvasEdge[],
    cards: ReadonlyMap<string, CanvasCard>,
    mask: readonly CanvasRectangle[]
  ): void {
    this.previewIds = undefined;
    this.previewState = undefined;
    this.layout = createCanvasEdgeLayout(edges, cards, 4, this.geometries);
    this.geometries = this.layout.read();
    this.entries = edges.map(edge => {
      const geometry = this.geometries.get(edge.id);
      if (!geometry) throw new Error('canvas_edge_geometry_missing');
      return entryFor(edge, geometry);
    });
    this.farEntries = this.entries.map(entry => ({
      ...entry,
      geometry: {
        ...entry.geometry,
        points: [entry.geometry.from, entry.geometry.to],
        midpoint: {
          x: (entry.geometry.from.x + entry.geometry.to.x) / 2,
          y: (entry.geometry.from.y + entry.geometry.to.y) / 2,
        },
      },
    }));
    this.base.clearCache();
    this.movingBase.setGeometry([]);
    this.movingGhost.shareGeometry(this.movingBase);
    this.applyMask(mask);
    this.key = '';
    this.emphasisKey = '';
    this.update();
  }
  /** 卡片遮挡变化后标签可能换位（或被整条挡住而隐藏），有标签时随之重画。 */
  setMask(mask: readonly CanvasRectangle[]): void {
    this.applyMask(mask);
    if (this.entries.some(entry => entry.edge.label)) this.update();
  }
  private applyMask(mask: readonly CanvasRectangle[]): void {
    this.maskRegions = mask;
    this.labelAnchors = new WeakMap();
    this.cardMask.clear();
    for (const region of mask) this.cardMask.rect(region.x, region.y, region.width, region.height);
    this.cardMask.fill(0xffffff);
  }
  preview(cardIds: readonly CanvasCardId[], cards: ReadonlyMap<string, CanvasCard>): void {
    if (!this.layout) return;
    if (!this.previewIds) {
      // 邻卡的同侧连接也可能重新排开；这些线独立于不变的世界线层，不能每个pointer重建全图。
      const movedCards = new Set<string>(cardIds),
        affectedCards = new Set<string>(cardIds);
      for (const entry of this.entries)
        if (
          [entry.edge.from, entry.edge.to].some(
            endpoint => endpoint.kind === 'card' && movedCards.has(endpoint.cardId)
          )
        ) {
          for (const endpoint of [entry.edge.from, entry.edge.to])
            if (endpoint.kind === 'card') affectedCards.add(endpoint.cardId);
        }
      this.previewIds = new Set(
        this.entries
          .filter(entry =>
            [entry.edge.from, entry.edge.to].some(
              endpoint => endpoint.kind === 'card' && affectedCards.has(endpoint.cardId)
            )
          )
          .map(entry => entry.edge.id)
      );
      this.key = '';
    }
    // 纸面遮罩由调用方先完成的空间投影统一更新；连线预览不能再次重建同一份Graphics。
    this.previewState = { cardIds, cards };
    this.refreshPreviewGeometry();
    this.update();
  }
  private refreshPreviewGeometry(): void {
    if (!this.layout || !this.previewState) return;
    const { cards, cardIds } = this.previewState;
    // 静态缓存覆盖最大倍率；拖动只需保持当前相机的1/4屏幕px误差，不能一律按4倍细分。
    const changed = new Set(this.layout.update(cards, cardIds, this.camera.zoom));
    this.entries = this.entries.map(entry => {
      if (!changed.has(entry.edge.id)) return entry;
      const geometry = this.geometries.get(entry.edge.id);
      if (!geometry) throw new Error('canvas_edge_geometry_missing');
      return entryFor(entry.edge, geometry);
    });
    this.farEntries = this.farEntries.map((entry, index) => {
      if (!changed.has(entry.edge.id)) return entry;
      const current = this.entries[index];
      return {
        ...current,
        geometry: {
          ...current.geometry,
          points: [current.geometry.from, current.geometry.to],
          midpoint: {
            x: (current.geometry.from.x + current.geometry.to.x) / 2,
            y: (current.geometry.from.y + current.geometry.to.y) / 2,
          },
        },
      };
    });
    this.movingDirty = true;
    this.emphasisKey = '';
  }
  setCamera(camera: CanvasCamera, width: number, height: number, resolution: number): void {
    const zoomChanged = this.camera.zoom !== camera.zoom;
    this.camera = camera;
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    if (this.previewIds) {
      if (zoomChanged) this.refreshPreviewGeometry();
      this.movingDirty = true;
    }
    const far = camera.zoom < 0.15;
    if (far !== this.far) {
      this.far = far;
      this.key = '';
    }
    this.update();
  }
  setAppearance(appearance: CanvasAppearance): void {
    this.appearance = appearance;
    this.update();
  }
  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    this.update();
  }
  setSelection(cards: readonly CanvasCardId[]): void {
    this.selectedCards = new Set(cards);
    this.update();
  }
  setSelected(id: CanvasEdgeId | null): void {
    this.selected = id;
    this.update();
  }
  setHovered(id: CanvasCardId | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.update();
  }
  /** DOM 标签编辑与连线工具条按标签实际所在位置摆放，与画布上的标签同一锚点。 */
  readGeometry(id: CanvasEdgeId): CanvasEdgeGeometry | null {
    const geometry = this.far
      ? (this.farEntries.find(entry => entry.edge.id === id)?.geometry ?? null)
      : (this.geometries.get(id) ?? null);
    const anchor = geometry && this.labelAnchor(geometry);
    return geometry && anchor ? { ...geometry, midpoint: anchor } : geometry;
  }
  private labelAnchor(geometry: CanvasEdgeGeometry): CanvasPoint | null {
    let anchor = this.labelAnchors.get(geometry);
    if (anchor === undefined) {
      anchor = canvasLineLabelAnchor(geometry.points, geometry.midpoint, this.maskRegions);
      this.labelAnchors.set(geometry, anchor);
    }
    return anchor;
  }
  private emphasized(edge: CanvasEdge): boolean {
    return [edge.from, edge.to].some(
      endpoint =>
        endpoint.kind === 'card' &&
        (this.selectedCards.has(endpoint.cardId) || endpoint.cardId === this.hovered)
    );
  }
  private update(): void {
    const { x, y, zoom } = this.camera;
    const entries = this.far ? this.farEntries : this.entries;
    const visible = entries.filter(
      entry =>
        entry.left * zoom + x <= this.width &&
        entry.right * zoom + x >= 0 &&
        entry.top * zoom + y <= this.height &&
        entry.bottom * zoom + y >= 0
    );
    this.visibleCount = visible.length;
    const allowed =
      visible.length > 3000
        ? visible.filter(entry => this.emphasized(entry.edge) || entry.edge.id === this.selected)
        : entries.length > 3000
          ? visible
          : entries;
    this.updateMeshes(allowed, visible);
    this.updateAppearance();
    this.drawEndpoints(visible.length > 3000 ? allowed : visible);
    this.drawLabels(visible);
  }
  private updateMeshes(allowed: readonly Entry[], visible: readonly Entry[]): void {
    const entries = this.far ? this.farEntries : this.entries;
    const stationary = this.previewIds
      ? allowed.filter(entry => !this.previewIds?.has(entry.edge.id))
      : allowed;
    const key = `${this.far}:${stationary.map(entry => entry.edge.id).join(',')}`;
    if (key !== this.key) {
      this.base.setGeometry(
        stationary,
        entries.length <= 3000 && !this.previewIds ? `${this.far}` : undefined
      );
      this.ghost.shareGeometry(this.base);
      this.key = key;
      this.builds++;
    }
    if (this.previewIds && this.movingDirty) {
      this.movingBase.setGeometry(
        (visible.length > 3000 ? allowed : visible).filter(entry =>
          this.previewIds?.has(entry.edge.id)
        )
      );
      this.movingGhost.shareGeometry(this.movingBase);
      this.movingDirty = false;
    }
    const emphasized = visible.filter(entry => this.emphasized(entry.edge));
    const emphasisKey = `${this.far}:${emphasized.map(entry => entry.edge.id).join(',')}:${this.selected}`;
    if (emphasisKey !== this.emphasisKey) {
      this.highlight.setGeometry(emphasized);
      this.selectedLine.setGeometry(allowed.filter(entry => entry.edge.id === this.selected));
      this.emphasisKey = emphasisKey;
    }
  }
  private chrome(): CanvasChromeColors {
    return this.appearance.chrome ?? canvasStandaloneChrome(this.appearance.dark);
  }
  private updateAppearance(): void {
    const { x, y, zoom } = this.camera;
    const { background, ink, accent } = this.chrome();
    const amount = zoom < 0.15 ? 0.1 : zoom < 0.3 ? 0.16 : 0.22;
    const palette = readCanvasLinePalette(this.appearance.dark);
    this.base.setColor(blend(ink, background, amount), 1, palette);
    this.movingBase.setColor(blend(ink, background, amount), 1, palette);
    this.ghost.setColor(ink, 1, palette);
    this.movingGhost.setColor(ink, 1, palette);
    this.highlight.setColor(blend(ink, background, 0.55), 1.25, palette);
    this.selectedLine.setColor(accent, 1.5);
    for (const layer of [
      this.base,
      this.ghost,
      this.movingBase,
      this.movingGhost,
      this.highlight,
      this.selectedLine,
    ])
      layer.setCamera(this.camera, this.resolution);
    this.cardMask.position.set(x, y);
    this.cardMask.scale.set(zoom);
    this.ghostArea.width = this.width;
    this.ghostArea.height = this.height;
    this.below.visible = !this.reduced || zoom >= 0.3;
    this.ghostContainer.visible = !this.reduced && zoom >= 0.3;
  }
  private drawLooseEnd(point: CanvasPoint, color: number): void {
    this.endpoints
      .circle(
        point.x * this.camera.zoom + this.camera.x,
        point.y * this.camera.zoom + this.camera.y,
        3
      )
      .fill(this.chrome().background)
      .stroke({ width: 1, color });
  }
  private drawEndpoints(visible: readonly Entry[]): void {
    this.endpoints.clear();
    const palette = readCanvasLinePalette(this.appearance.dark),
      { background, ink, accent } = this.chrome();
    const neutral = blend(
      ink,
      background,
      this.camera.zoom < 0.15 ? 0.1 : this.camera.zoom < 0.3 ? 0.16 : 0.22
    );
    for (const { edge, geometry } of visible) {
      const color = edge.color === 'white' ? neutral : palette[edge.color];
      // 只有无箭头的悬空端才是空心圆；选中后的实心点另作拖动控制点。
      if (edge.from.kind === 'point' && edge.direction !== 'both')
        this.drawLooseEnd(geometry.from, color);
      if (edge.to.kind === 'point' && edge.direction === 'none')
        this.drawLooseEnd(geometry.to, color);
    }
    const geometry = this.selected ? this.geometries.get(this.selected) : undefined;
    if (!geometry) return;
    for (const point of [geometry.from, geometry.to])
      this.endpoints
        .circle(
          point.x * this.camera.zoom + this.camera.x,
          point.y * this.camera.zoom + this.camera.y,
          3.5
        )
        .fill(accent)
        .stroke({ width: 1, color: background });
  }
  private drawLabels(visible: readonly Entry[]): void {
    const labeled = visible.filter(entry => entry.edge.label);
    this.labels.visible = labeled.length > 0;
    if (!labeled.length) return;
    const context = this.labelLayer.prepare(
      this.width * this.resolution,
      this.height * this.resolution
    );
    context.scale(this.resolution, this.resolution);
    context.font = CANVAS_LINE_LABEL_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const { background, label } = this.chrome(),
      css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
    context.strokeStyle = css(background);
    context.fillStyle = css(label);
    context.lineWidth = 5;
    for (const entry of labeled) {
      const point = this.labelAnchor(entry.geometry);
      if (!point) continue;
      const label = canvasFitLineLabel(entry.edge.label, text => context.measureText(text).width);
      const x = point.x * this.camera.zoom + this.camera.x,
        y = point.y * this.camera.zoom + this.camera.y;
      context.strokeText(label, x, y);
      context.fillText(label, x, y);
    }
    this.labelLayer.commit(this.width, this.height);
  }
  hitTest(point: CanvasPoint): CanvasEdge | null {
    const tolerance = 6 / this.camera.zoom;
    const entries = this.far ? this.farEntries : this.entries;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (
        point.x < entry.left - tolerance ||
        point.x > entry.right + tolerance ||
        point.y < entry.top - tolerance ||
        point.y > entry.bottom + tolerance
      )
        continue;
      const { points } = entry.geometry;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          dx = b.x - a.x,
          dy = b.y - a.y,
          length = dx * dx + dy * dy;
        const t = length
          ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
          : 0;
        if (Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= tolerance)
          return entry.edge;
      }
    }
    return null;
  }
  readStats() {
    return { lineMeshBuilds: this.builds, visibleEdges: this.visibleCount };
  }
  destroy(): void {
    this.ghost.destroy();
    this.movingGhost.destroy();
    this.movingBase.destroy();
    this.highlight.destroy();
    this.selectedLine.destroy();
    this.base.destroy();
    this.labelLayer.destroy();
    this.below.destroy({ children: true });
    this.above.destroy({ children: true });
    this.ghostAlpha.destroy();
  }
}
