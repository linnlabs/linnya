import type { ChartRenderNode } from '../../../../types/render';
import { INCHES_TO_PX } from '../../../../shared/constants';

export function buildChartImageConfig(
  node: ChartRenderNode,
  image: HTMLImageElement,
) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    width: Math.round(node.box.w * INCHES_TO_PX),
    height: Math.round(node.box.h * INCHES_TO_PX),
    image,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
    listening: false,
  };
}

export function buildChartPlaceholderConfig(node: ChartRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    width: Math.round(node.box.w * INCHES_TO_PX),
    height: Math.round(node.box.h * INCHES_TO_PX),
    fill: 'transparent',
    listening: false,
  };
}
