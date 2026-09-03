import type { RenderNode, SlideRenderModel } from '../../../types/render';
import type { SlideImageResourceTarget } from '../definitions/renderImageResource';
import { svgGraphicDataUri } from '../../svgGraphicRendering';
import { formulaDataUri } from '../../formulaRendering';

export const SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY = '__slide-background__';

/**
 * 只收集当前页面真实可见的图片。group 递归规则集中在这里，避免主舞台与
 * 离屏栅格分别维护一套资源发现逻辑。
 */
export function collectSlideImageResourceTargets(
  slide: SlideRenderModel,
): SlideImageResourceTarget[] {
  const targets: SlideImageResourceTarget[] = [];
  if (slide.background.imageSrc) {
    targets.push({
      key: SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY,
      source: slide.background.imageSrc,
    });
  }

  collectNodeImageTargets(slide.elements, targets);
  return targets;
}

function collectNodeImageTargets(
  nodes: readonly RenderNode[],
  targets: SlideImageResourceTarget[],
): void {
  for (const node of nodes) {
    if (node.visible === false) {
      continue;
    }

    if (node.kind === 'image') {
      targets.push({
        key: node.id,
        source: node.assetRef,
      });
      continue;
    }

    if (node.kind === 'text') {
      for (const run of node.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        if ('text' in run) continue;
        targets.push({
          key: `formula:${run.projection.contentHash}`,
          source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(run.projection.canonicalSvg)}`,
        });
      }
      continue;
    }

    if (node.kind === 'svgGraphic') {
      targets.push({
        key: node.id,
        source: svgGraphicDataUri(node),
      });
      continue;
    }

    if (node.kind === 'formula') {
      targets.push({ key: node.id, source: formulaDataUri(node) });
      continue;
    }

    if (node.kind === 'group') {
      collectNodeImageTargets(node.children, targets);
    }
  }
}
