import { Container, NineSliceSprite } from 'pixi.js';
import {
  CANVAS_CARD_BACKGROUND_SLICE,
  CANVAS_CARD_SHADOW_BLEED,
  CANVAS_CARD_SHADOW_SLICE,
} from './createCanvasCardBackground';
import {
  CANVAS_SECTION_HEADER,
  CANVAS_SECTION_PADDING,
  readCanvasElementText,
  readCanvasCardPalette,
  readCanvasSectionPalette,
  type CanvasCard,
  type CanvasCardId,
  type CanvasRectangle,
} from '../../../../shared';
import type { CanvasRasterTile } from '../../definitions/canvasKernel';
import { intersectCanvasRegion } from '../../geometry/canvasVisibleRegions';
import { canvasFitText } from '../../geometry/canvasFitText';
import { canvasTitlePrefix } from '../../geometry/canvasTextGraphemes';
import type { CanvasCardView } from './definitions/canvasCardView';
import { fitCanvasPaperClip } from './canvasPaperClip';
import type { CanvasCardPresentationOptions } from './definitions/canvasCardPresentation';

/** 卡片的纸面、身份牌与采样回执；不拥有逻辑元素、相机或场景时钟。 */
export class CanvasCardPresentation {
  private exposed: readonly CanvasCard[] = [];
  private exposedIds = new Set<CanvasCardId>();
  private visibleRegions: ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> = new Map();
  private documentTitles: ReadonlyMap<string, string> = new Map();
  private thumbnailCards: ReadonlySet<CanvasCardId> = new Set();
  private readonly identityTitles = new Map<string, string>();
  private readonly textTitles = new WeakMap<CanvasCard, string>();
  constructor(private readonly options: CanvasCardPresentationOptions) {}

  displayCards(): CanvasCard[] {
    return this.options.readOrdered().flatMap(card => {
      const display = this.options.cards.get(card.id);
      return display ? [display] : [];
    });
  }
  orderViews(): void {
    const views = [...this.options.retiringViews.values(), ...this.options.views.values()].sort(
      (a, b) => (a.card.order < b.card.order ? -1 : a.card.order > b.card.order ? 1 : 0)
    );
    // 分区与卡片各在自己的层里排序，下标按层分别计数。
    const index = new Map<Container, number>();
    for (const view of views) {
      const layer = view.container.parent;
      if (!layer) continue;
      const next = index.get(layer) ?? 0;
      layer.setChildIndex(view.container, next);
      index.set(layer, next + 1);
    }
  }
  /** 分区只画染纸底和标题：没有投影、正文位图或图片裁切。 */
  private updateSectionView(view: CanvasCardView): void {
    const { card, shadow, background, body, label, container } = view;
    container.visible = this.exposedIds.has(card.id);
    background.texture = this.options.backgrounds.section;
    background.width = card.width;
    background.height = card.height;
    shadow.visible = false;
    body.visible = false;
    const palette = readCanvasSectionPalette(
      card.color,
      this.options.context.readAppearance().dark
    );
    background.tint = palette.fill;
    label.tint = palette.title;
    label.visible = this.identityVisible(card);
    this.options.identities.setActive(label, container.visible && label.visible);
    const bounds = this.identityBounds(card);
    label.position.set(bounds.x, bounds.y);
    view.lodAlpha = 1;
    this.options.applyMotion(view);
  }

  updateView(view: CanvasCardView): void {
    if (view.card.type === 'section') {
      this.updateSectionView(view);
      return;
    }
    const { card, shadow, background, body, label, container } = view;
    const wasVisible = container.visible && body.visible;
    container.visible = this.exposedIds.has(card.id);
    const material = this.options.context.readAppearance().material;
    background.texture = this.options.backgrounds[material];
    background.width = card.width;
    background.height = card.height;
    shadow.visible = material === 'card';
    fitCanvasPaperClip(view, material);
    if (shadow.visible) {
      shadow.width = card.width + CANVAS_CARD_SHADOW_BLEED * 2;
      shadow.height = card.height + CANVAS_CARD_SHADOW_BLEED * 2;
    }
    const palette = readCanvasCardPalette(card.color, this.options.context.readAppearance().dark);
    background.tint = palette.paper;
    // 近景身份牌必须复用纹理；连续缩放不能每个事件重新生成几百张文字纹理。
    // 字形始终烘为白色，纸色/主题通过GPU tint改变深墨；否则500次染纸会重建500张字形纹理。
    label.tint = palette.title;
    const overview =
      !this.keepsThumbnail(card) &&
      this.options.context.readCamera().zoom < 0.3 &&
      this.options.context.readAppearance().overview === 'titles';
    label.visible = this.identityVisible(card);
    body.visible = !overview && this.options.bitmaps.has(card.id);
    if (this.options.context.readEditingCard() === card.id) body.visible = false;
    this.options.identities.setActive(label, container.visible && label.visible);
    if (!wasVisible && container.visible && body.visible) {
      view.visibleAfterRender = this.options.context.readRenders();
      view.firstVisibleAfterRender = this.options.context.readRenders();
    }
    const bounds = this.identityBounds(card);
    label.position.set(bounds.x, bounds.y);
    // 地图标题以屏幕排版框避让；卡片远景淡影不参与标题优先序。
    view.lodAlpha =
      this.options.context.readCamera().zoom < 0.15 && !this.options.context.selected.has(card.id)
        ? 0.6
        : 1;
    this.options.applyMotion(view);
  }
  identityVisible(card: CanvasCard): boolean {
    const overview =
      !this.keepsThumbnail(card) &&
      this.options.context.readCamera().zoom < 0.3 &&
      this.options.context.readAppearance().overview === 'titles';
    return (
      this.options.context.readCamera().zoom >= 0.15 &&
      this.options.context.readEditingCard() !== card.id &&
      !overview &&
      this.titleExposed(card) &&
      !(this.options.context.showsOldLayout(card.id) && this.options.bitmaps.has(card.id)) &&
      !this.options.bitmaps.covers(card.id, this.readVisibleCardRegions(card.id))
    );
  }
  private identityBounds(card: CanvasCard): CanvasRectangle {
    if (card.type === 'section')
      return {
        x: CANVAS_SECTION_PADDING,
        y: 14,
        width: Math.max(1, card.width - CANVAS_SECTION_PADDING * 2),
        height: Math.min(CANVAS_SECTION_HEADER - 14, card.height),
      };
    const x = Math.min(14, card.width / 8),
      y = Math.min(12, card.height / 8);
    return { x, y, width: card.width - x * 2, height: card.height - y * 2 };
  }
  identityTitle(card: CanvasCard): string {
    const source =
      canvasTitlePrefix(this.title(card), 120) ||
      (card.type === 'image'
        ? this.options.text.imageTitle()
        : card.type === 'section'
          ? this.options.text.sectionTitle()
          : this.options.text.blankTitle());
    const width = this.identityBounds(card).width,
      key = `${width}:${source}`,
      existing = this.identityTitles.get(key);
    if (existing !== undefined) return existing;
    if (this.identityTitles.size >= 4096) this.identityTitles.clear();
    const fitted = canvasFitText(
      source,
      text => this.options.identityContext.measureText(text).width,
      width
    );
    this.identityTitles.set(key, fitted);
    return fitted;
  }
  private titleExposed(card: CanvasCard): boolean {
    const region = this.identityBounds(card);
    if (region.height < 18) return false;
    return this.readVisibleCardRegions(card.id).some(
      visible => intersectCanvasRegion(region, visible) !== null
    );
  }
  title(card: CanvasCard): string {
    if (card.type === 'document')
      return this.documentTitles.get(card.data.documentId) ?? this.options.text.documentTitle();
    const cached = this.textTitles.get(card);
    if (cached !== undefined) return cached;
    const value = readCanvasElementText(card);
    this.textTitles.set(card, value);
    return value;
  }

  createView(card: CanvasCard): CanvasCardView {
    const container = new Container();
    const shadow = new NineSliceSprite({
      texture: this.options.backgrounds.shadow,
      leftWidth: CANVAS_CARD_SHADOW_SLICE,
      rightWidth: CANVAS_CARD_SHADOW_SLICE,
      topHeight: CANVAS_CARD_SHADOW_SLICE,
      bottomHeight: CANVAS_CARD_SHADOW_SLICE,
    });
    shadow.position.set(-CANVAS_CARD_SHADOW_BLEED);
    const background = new NineSliceSprite({
      texture: this.options.backgrounds[this.options.context.readAppearance().material],
      leftWidth: CANVAS_CARD_BACKGROUND_SLICE,
      rightWidth: CANVAS_CARD_BACKGROUND_SLICE,
      topHeight: CANVAS_CARD_BACKGROUND_SLICE,
      bottomHeight: CANVAS_CARD_BACKGROUND_SLICE,
    });
    const body = new Container();
    body.visible = false;
    const label = this.options.identities.create(this.identityTitle(card));
    container.addChild(shadow, background, body, label);
    (card.type === 'section' ? this.options.sectionLayer : this.options.layer).addChild(container);
    const view: CanvasCardView = {
      card,
      container,
      shadow,
      background,
      body,
      label,
      visibleAfterRender: this.options.context.readRenders(),
      firstVisibleAfterRender: this.options.context.readRenders(),
      rasterContentKey: undefined,
      lodAlpha: 1,
      paperClip: null,
    };
    return view;
  }
  setRasterContentKey(id: CanvasCardId, key: string): void {
    const view = this.options.views.get(id);
    if (!view || view.rasterContentKey === key) return;
    // 内容/授权世代改变不是采样升级，旧封面和标签不能在新世代继续淡出。
    view.rasterContentKey = key;
    this.options.bitmaps.remove(id);
    this.options.schedule();
  }
  readRasterReceipt(
    id: CanvasCardId,
    key: string
  ): {
    readonly acceptedAfterRender: number;
    readonly firstPresented: boolean;
    readonly rendered: boolean;
  } | null {
    const accepted = this.options.bitmaps.readReceipt(id, key),
      view = this.options.views.get(id);
    if (accepted === null || !view) return null;
    const acceptedAfterRender = Math.max(accepted.acceptedAfterRender, view.visibleAfterRender);
    const visible =
      !this.options.context.readContextLost() &&
      view.container.visible &&
      view.body.visible &&
      view.container.alpha > 0;
    // 首显只认可新层alpha真正大于0后完成的draw；alpha0首帧及仅上传纹理均不能作证。
    const firstPresented =
      visible &&
      accepted.firstVisibleAfterRender !== null &&
      this.options.context.readRenders() >
        Math.max(accepted.firstVisibleAfterRender, view.firstVisibleAfterRender);
    return {
      acceptedAfterRender,
      firstPresented,
      rendered:
        visible &&
        !this.options.bitmaps.isFading(id) &&
        !this.options.hasMotion(id) &&
        this.options.context.readRenders() > acceptedAfterRender,
    };
  }
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean {
    const card = this.options.cards.get(id);
    if (!card) {
      bitmap.close();
      return false;
    }
    return this.setRasterTiles(id, revision, key, [
      {
        bitmap,
        scale: bitmap.width / card.width,
        x: 0,
        y: 0,
        width: card.width,
        height: card.height,
      },
    ]);
  }
  setRasterTiles(
    id: CanvasCardId,
    revision: number,
    key: string,
    tiles: readonly CanvasRasterTile[]
  ): boolean {
    const card = this.options.cards.get(id);
    const view = this.options.views.get(id);
    if (!card || !view || card.revision !== revision || this.options.context.readDestroyed()) {
      tiles.forEach(tile => tile.bitmap.close());
      return false;
    }
    return this.options.bitmaps.install(id, key, tiles, view.body);
  }
  keepsThumbnail(card: CanvasCard): boolean {
    return card.type === 'image' || this.thumbnailCards.has(card.id);
  }
  setDocumentTitles(titles: ReadonlyMap<string, string>): void {
    const changed = new Set<string>();
    for (const [id, title] of this.documentTitles) if (titles.get(id) !== title) changed.add(id);
    for (const [id, title] of titles) if (this.documentTitles.get(id) !== title) changed.add(id);
    if (!changed.size) return;
    this.documentTitles = new Map(titles);
    let mapChanged = false,
      sceneChanged = false;
    // 逐条授权元数据返回时只更新对应身份牌，不能为一张标题重新裁切2500份文本。
    for (const views of [this.options.views, this.options.retiringViews])
      for (const [id, view] of views) {
        if (view.card.type !== 'document' || !changed.has(view.card.data.documentId)) continue;
        this.options.identities.setText(view.label, this.identityTitle(view.card));
        sceneChanged ||= view.container.visible && view.label.visible;
        mapChanged ||= this.options.mapLabels.dependsOnTitle(id);
      }
    // 优先序不随标题变化，但拟合宽度会影响避让；已量宽的隐藏候选也可能因改短重新露出。
    if (mapChanged) {
      this.options.mapLabels.invalidate();
      this.options.updateLabels();
    }
    if (mapChanged || sceneChanged) this.options.schedule();
  }
  setThumbnailCards(ids: ReadonlySet<CanvasCardId>): void {
    const changed = new Set<CanvasCardId>();
    for (const id of this.thumbnailCards) if (!ids.has(id)) changed.add(id);
    for (const id of ids) if (!this.thumbnailCards.has(id)) changed.add(id);
    if (!changed.size) return;
    const mapChanged = [...changed].some(id => !ids.has(id) || this.options.mapLabels.hasLabel(id));
    this.thumbnailCards = new Set(ids);
    // 缩略偏好不改变位置或遮挡；仅重投影变化卡的正文/身份牌可见性。
    for (const id of changed) {
      const view = this.options.views.get(id);
      if (view) this.updateView(view);
    }
    this.options.refreshTitleOrder();
    if (mapChanged) {
      this.options.mapLabels.invalidate();
      this.options.updateLabels();
    }
    this.options.schedule();
  }

  projectCards(styleChanged: boolean): void {
    const projection = this.options.spatial.project({
      x: -this.options.context.readCamera().x / this.options.context.readCamera().zoom,
      y: -this.options.context.readCamera().y / this.options.context.readCamera().zoom,
      width: this.options.context.readWidth() / this.options.context.readCamera().zoom,
      height: this.options.context.readHeight() / this.options.context.readCamera().zoom,
    });
    if (projection !== this.visibleRegions) {
      this.visibleRegions = projection;
      this.options.maskChanged();
    }
    this.exposed = this.options.readOrdered().flatMap(entry => {
      const card = this.options.cards.get(entry.id);
      return card && this.readVisibleCardRegions(card.id).length ? [card] : [];
    });
    this.exposedIds = new Set(this.exposed.map(card => card.id));
    for (const view of this.options.views.values()) {
      if (styleChanged) this.updateView(view);
      else {
        const wasVisible = view.container.visible;
        view.container.visible = this.exposedIds.has(view.card.id);
        if (!wasVisible && view.container.visible) {
          view.visibleAfterRender = this.options.context.readRenders();
          view.firstVisibleAfterRender = this.options.context.readRenders();
        }
        if (view.container.visible) {
          view.label.visible = this.identityVisible(view.card);
        }
      }
      if (view.container.visible && this.options.context.readCamera().zoom >= 0.3) {
        this.options.bitmaps.touch(view.card.id);
      }
      this.options.identities.setActive(view.label, view.container.visible && view.label.visible);
    }
  }
  private visible(card: CanvasCard): boolean {
    return (
      card.x * this.options.context.readCamera().zoom + this.options.context.readCamera().x <=
        this.options.context.readWidth() &&
      (card.x + card.width) * this.options.context.readCamera().zoom +
        this.options.context.readCamera().x >=
        0 &&
      card.y * this.options.context.readCamera().zoom + this.options.context.readCamera().y <=
        this.options.context.readHeight() &&
      (card.y + card.height) * this.options.context.readCamera().zoom +
        this.options.context.readCamera().y >=
        0
    );
  }
  visibleCards(): readonly CanvasCard[] {
    return this.options.readOrdered().flatMap(entry => {
      const card = this.options.cards.get(entry.id);
      return card && this.visible(card) ? [card] : [];
    });
  }
  /** 分区没有正文或媒体内容，只画底色和标题，不进入内容与位图管线。 */
  renderableCards(): readonly CanvasCard[] {
    return this.exposed.filter(card => card.type !== 'section');
  }
  rasterCards(): readonly CanvasCard[] {
    const cards = this.renderableCards();
    return this.options.context.readAppearance().overview === 'thumbnails' ||
      this.options.context.readCamera().zoom >= 0.3
      ? cards
      : cards.filter(card => this.keepsThumbnail(card));
  }
  readVisibleCardRegions(id: CanvasCardId): readonly CanvasRectangle[] {
    const card = this.options.cards.get(id);
    if (!card) return [];
    const regions = this.visibleRegions.get(id) ?? [];
    const viewport = {
      x: -this.options.context.readCamera().x / this.options.context.readCamera().zoom,
      y: -this.options.context.readCamera().y / this.options.context.readCamera().zoom,
      width: this.options.context.readWidth() / this.options.context.readCamera().zoom,
      height: this.options.context.readHeight() / this.options.context.readCamera().zoom,
    };
    return regions.flatMap(region => {
      const visible = intersectCanvasRegion(region, viewport),
        view = this.options.views.get(id);
      if (!visible || !view) return [];
      const scale = view.container.scale.x,
        bounds = {
          x: view.container.x,
          y: view.container.y,
          width: card.width * scale,
          height: card.height * scale,
        };
      const part = intersectCanvasRegion(visible, bounds);
      return part
        ? [
            {
              x: (part.x - bounds.x) / scale,
              y: (part.y - bounds.y) / scale,
              width: part.width / scale,
              height: part.height / scale,
            },
          ]
        : [];
    });
  }
  readRegions(): ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> {
    return this.visibleRegions;
  }
  clearTitles(): void {
    this.identityTitles.clear();
  }
  destroyBackgrounds(): void {
    this.options.backgrounds.section.destroy(true);
    this.options.backgrounds.paper.destroy(true);
    this.options.backgrounds.card.destroy(true);
    this.options.backgrounds.shadow.destroy(true);
  }
}
