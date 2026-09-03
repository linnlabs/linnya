import type { RenderNode, SlideRenderModel } from '../../../types/render';
import type { SlideChartResourceTarget } from '../definitions/renderChartResource';

/** 主舞台与离屏栅格共用的图表发现规则。 */
export function collectSlideChartResourceTargets(
  slide: SlideRenderModel,
): SlideChartResourceTarget[] {
  const targets: SlideChartResourceTarget[] = [];
  collectNodeChartTargets(slide.elements, targets);
  return targets;
}

function collectNodeChartTargets(
  nodes: readonly RenderNode[],
  targets: SlideChartResourceTarget[],
): void {
  for (const node of nodes) {
    if (node.visible === false) continue;

    if (node.kind === 'chart') {
      // 零面积节点没有可见像素，也不应创建 ECharts 实例。
      if (node.box.w > 0 && node.box.h > 0) {
        targets.push({ key: node.id, node });
      }
      continue;
    }

    if (node.kind === 'group') {
      collectNodeChartTargets(node.children, targets);
    }
  }
}
