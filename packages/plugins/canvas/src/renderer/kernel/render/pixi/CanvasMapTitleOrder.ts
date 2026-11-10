import type { CanvasCard, CanvasCardId } from '../../../../shared';
import type { CanvasCardView } from './definitions/canvasCardView';

/** 远景地图标签的展示优先序：染色卡、文档卡、面积大者先占位；选中卡在同序内前置。 */
export class CanvasMapTitleOrder {
  private overview: readonly CanvasCard[] = [];
  private titles: readonly CanvasCard[] = [];
  constructor(
    private readonly source: {
      readonly cards: ReadonlyMap<CanvasCardId, CanvasCard>;
      readonly selected: ReadonlySet<CanvasCardId>;
      readonly retiringLabels: ReadonlySet<CanvasCardId>;
      readonly retiringViews: ReadonlyMap<CanvasCardId, CanvasCardView>;
      keepsThumbnail(card: CanvasCard): boolean;
    }
  ) {}
  read(): readonly CanvasCard[] {
    return this.titles;
  }
  setCards(cards: readonly CanvasCard[]): void {
    this.overview = [...cards].sort(
      (a, b) =>
        Number(b.color !== 'white') - Number(a.color !== 'white') ||
        Number(b.type === 'document') - Number(a.type === 'document') ||
        b.width * b.height - a.width * a.height
    );
    this.refreshCards();
  }
  /** 只换成当前显示姿态，不重新排序整张画布。 */
  refreshCards(): void {
    this.overview = this.overview.map(card => this.source.cards.get(card.id) ?? card);
    this.refresh();
  }
  refresh(): void {
    const selected: CanvasCard[] = [],
      remaining: CanvasCard[] = [];
    for (const card of this.overview) {
      if (this.source.keepsThumbnail(card)) continue;
      (this.source.selected.has(card.id) ? selected : remaining).push(card);
    }
    // 只保留删除前实际展示的地图标签，不能让原先被去重的旧标题突然冒出来。
    const retiring = [...this.source.retiringLabels].flatMap(id => {
      const view = this.source.retiringViews.get(id);
      return view ? [view.card] : [];
    });
    this.titles = [...retiring, ...selected, ...remaining];
  }
}
