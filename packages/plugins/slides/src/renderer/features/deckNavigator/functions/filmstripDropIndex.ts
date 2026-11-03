/**
 * 拖动重排时按指针在页面条滚动内容里的横坐标求落点页。
 * 每页的命中范围从左侧缩略图间距的中线延伸到右侧间距的中线，落在间距里归给更近的一页；
 * 越过首页或末页时取首页或末页，所以整条页面条（含末页之后的留白）都能放下。
 * contentX 与 inset 处于同一滚动内容坐标系；没有页或宽度无效时返回 null。
 */
export function resolveFilmstripDropIndex(input: {
  readonly contentX: number;
  readonly inset: number;
  readonly itemWidth: number;
  readonly gap: number;
  readonly slideCount: number;
}): number | null {
  if (input.slideCount <= 0 || !(input.itemWidth > 0)) return null;
  const slot = Math.floor((input.contentX - input.inset + input.gap / 2) / input.itemWidth);
  return Math.min(Math.max(slot, 0), input.slideCount - 1);
}
