import {
  buildSlideSourceSpanLocusKey,
  type PresentationRenderModel,
  visitRenderNodes,
} from '@plugin/slides/shared';

/**
 * 从完整快照统计静态创建位置生成了多少 RenderNode。
 * 页选择之后再统计会把跨页 helper 误标成 direct creation，因此 runtime 必须先调用本函数。
 */
export function countSourceSpanUses(
  renderModel: PresentationRenderModel,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const slide of renderModel.slides) {
    visitRenderNodes(slide.elements, ({ node }) => {
      if (!node.sourceSpan) return;
      const key = buildSlideSourceSpanLocusKey(node.sourceSpan);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return counts;
}
