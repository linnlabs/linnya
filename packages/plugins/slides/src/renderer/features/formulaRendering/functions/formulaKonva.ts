import type { MathFormulaRenderNode } from '../../../types/render';
import type { TextRenderNode } from '../../../types/render';
import type { LoadedRenderImage } from '../../renderImageResources';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../shared/constants';

export function formulaDataUri(node: MathFormulaRenderNode): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.canonicalSvg)}`;
}

export function buildFormulaGroupConfig(node: MathFormulaRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
}

export function buildFormulaImageConfig(
  node: MathFormulaRenderNode,
  resource: LoadedRenderImage,
) {
  return {
    ...resolveFormulaPlacement(node),
    image: resource.image,
  };
}

export function buildFormulaPlaceholderConfig(node: MathFormulaRenderNode) {
  return {
    x: 0,
    y: 0,
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    fill: SLIDES_RENDER_COLORS.imagePlaceholderFill,
    stroke: SLIDES_RENDER_COLORS.imagePlaceholderStroke,
    strokeWidth: 1,
  };
}

export interface InlineFormulaImageConfig {
  key: string;
  config: {
    x: number;
    y: number;
    width: number;
    height: number;
    image: HTMLImageElement;
  };
}

export function buildInlineFormulaImageConfigs(
  node: TextRenderNode,
  resources: ReadonlyMap<string, LoadedRenderImage>,
): InlineFormulaImageConfig[] {
  if (!node.layout) return [];
  const padLeft = (node.padding?.left ?? 0) * INCHES_TO_PX;
  const padTop = (node.padding?.top ?? 0) * INCHES_TO_PX;
  return node.layout.lines.flatMap((line) => line.slices.flatMap((slice) => {
    if (slice.kind !== 'inlineBox') return [];
    const resource = resources.get(slice.identity);
    if (!resource) return [];
    const scale = slice.width * INCHES_TO_PX
      / Math.max(1, slice.projection.contentViewBox.width);
    const contentOffsetX = slice.projection.contentViewBox.x - slice.projection.viewBox.x;
    const contentOffsetY = slice.projection.contentViewBox.y - slice.projection.viewBox.y;
    return [{
      key: `${slice.identity}:${slice.paragraphIndex}:${slice.runIndex}:${slice.x}`,
      config: {
        x: padLeft + slice.x * INCHES_TO_PX - contentOffsetX * scale,
        y: padTop + slice.boxY * INCHES_TO_PX - contentOffsetY * scale,
        width: slice.projection.viewBox.width * scale,
        height: slice.projection.viewBox.height * scale,
        image: resource.image,
      },
    }];
  }));
}

export function resolveFormulaPlacement(node: MathFormulaRenderNode) {
  const boxWidth = node.box.w * INCHES_TO_PX;
  const boxHeight = node.box.h * INCHES_TO_PX;
  const layoutWidth = Math.max(1, node.contentViewBox.width);
  const nativeScale = node.metrics.advanceWidth * INCHES_TO_PX / layoutWidth;
  const naturalWidth = node.viewBox.width * nativeScale;
  const naturalHeight = node.viewBox.height * nativeScale;
  const scale = Math.min(1, boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const renderScale = nativeScale * scale;
  const contentWidth = node.contentViewBox.width * renderScale;
  const contentHeight = node.contentViewBox.height * renderScale;
  const contentOffsetX = (node.contentViewBox.x - node.viewBox.x) * renderScale;
  const contentOffsetY = (node.contentViewBox.y - node.viewBox.y) * renderScale;
  const contentX = node.align === 'left'
    ? 0
    : node.align === 'right'
      ? boxWidth - contentWidth
      : (boxWidth - contentWidth) / 2;
  return {
    x: contentX - contentOffsetX,
    y: (boxHeight - contentHeight) / 2 - contentOffsetY,
    width,
    height,
  };
}
