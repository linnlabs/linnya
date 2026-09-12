import type { ThemeInfo } from '@plugin/slides/shared';
import type {
  ThemeSpec,
  Box,
  FreeformSlideSpec,
  ImageSourceInput,
  ImageVisualShadow,
  Paint,
  SlideBackgroundGradient,
  StructuredSlideSpec,
  ShapeStyle,
} from '@plugin/slides/shared';
import type { ThemeChartPalette } from '@plugin/slides/shared';
import type {
  EditableTarget,
  GeneratedLayoutConstraintEvidence,
  GroupRenderNode,
  RenderAssetRef,
  RenderBox,
  RenderChartLegend,
  RenderChartType,
  RenderFill,
  RenderShadow,
  RenderSourceSpan,
  RenderStroke,
  SlideBackgroundModel,
} from '@plugin/slides/shared';
import { resolveImageAsset } from '../../assets/imageAssetResolver';
import {
  IDENTITY_TRANSFORM,
  applyFreeformTransform,
  buildGroupTransform,
  type FreeformTransform,
} from '../../text/generatedTextRenderInput';
import { resolveChartPalette, resolveThemeFonts } from '../../visual/presentationVisualDefaults';

export { IDENTITY_TRANSFORM, applyFreeformTransform, buildGroupTransform, type FreeformTransform };

export interface SlideSize {
  width: number;
  height: number;
}

export interface RenderDefaultsContext {
  chartPalette: ThemeChartPalette;
  majorFontFamily: string;
  minorFontFamily: string;
}

export interface RenderBaseNode {
  id: string;
  box: RenderBox;
  zIndex: number;
  editableTarget?: EditableTarget;
  sourceSpan?: RenderSourceSpan;
  layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
  rotation?: number;
  opacity?: number;
  visible: true;
}

export function resolveRenderDefaults(
  theme: ThemeInfo | ThemeSpec | undefined
): RenderDefaultsContext {
  const fonts = resolveThemeFonts(theme);
  return {
    chartPalette: resolveChartPalette(theme),
    majorFontFamily: fonts.major,
    minorFontFamily: fonts.minor,
  };
}

export function resolveBackground(
  spec: StructuredSlideSpec | FreeformSlideSpec | undefined
): SlideBackgroundModel {
  const background = spec?.background;
  const paint =
    background?.paint ??
    background?.gradient ??
    (background?.color
      ? { type: 'solid' as const, color: background.color }
      : { type: 'solid' as const, color: '#FFFFFF' });
  return {
    paint,
    imageSrc: background?.image ? resolveBackgroundImageSrc(background.image) : undefined,
  };
}

function resolveBackgroundImageSrc(source: ImageSourceInput): string {
  const asset = resolveImageAsset(source);
  switch (asset.kind) {
    case 'data_uri':
      return asset.dataUri;
    case 'local_file':
      return asset.path;
  }
}

export function resolveGeneratedLayoutKey(spec: StructuredSlideSpec | FreeformSlideSpec): string {
  if (spec.type === 'freeform') {
    return 'freeform';
  }

  return 'structured';
}

export function resolveChartType(chartType: string | undefined): RenderChartType {
  switch (chartType) {
    case 'bar':
    case 'column':
    case 'line':
    case 'pie':
    case 'doughnut':
    case 'scatter':
    case 'area':
    case 'radar':
    case 'combo':
      return chartType;
    default:
      return 'bar';
  }
}

export function resolveChartLegend(
  options: Record<string, unknown> | undefined
): RenderChartLegend | undefined {
  if (options == null) {
    return { visible: false };
  }

  const explicitVisible = typeof options.showLegend === 'boolean' ? options.showLegend : undefined;
  const position = resolveLegendPosition(options.legendPos);

  if (explicitVisible === undefined && position === undefined) {
    return { visible: false };
  }

  if (explicitVisible === false) {
    return { visible: false };
  }

  return {
    visible: explicitVisible ?? true,
    position: position ?? 'right',
  };
}

function resolveLegendPosition(legendPos: unknown): RenderChartLegend['position'] | undefined {
  switch (legendPos) {
    case 'b':
      return 'bottom';
    case 'l':
      return 'left';
    case 'r':
      return 'right';
    case 't':
    case 'tr':
      return 'top';
    default:
      return undefined;
  }
}

export function resolveFill(
  paint: Paint | undefined,
  legacyColor?: string,
  legacyGradient?: SlideBackgroundGradient
): RenderFill | undefined {
  return (
    paint ?? legacyGradient ?? (legacyColor ? { type: 'solid', color: legacyColor } : undefined)
  );
}

export function resolveStroke(border: ShapeStyle['border']): RenderStroke | undefined {
  if (!border) {
    return undefined;
  }

  return {
    paint:
      border.paint ?? (border.color ? { type: 'solid', color: border.color } : { type: 'none' }),
    width: border.width,
    dash: resolveStrokeDash(border.dash),
  };
}

function resolveStrokeDash(
  dash: ShapeStyle['border'] extends undefined ? never : NonNullable<ShapeStyle['border']>['dash']
): RenderStroke['dash'] | undefined {
  switch (dash) {
    case 'solid':
    case 'dash':
    case 'dot':
      return dash;
    default:
      return undefined;
  }
}

export function resolveShadow(shadow: ShapeStyle['shadow']): RenderShadow | undefined {
  if (!shadow) {
    return undefined;
  }

  return {
    color: shadow.color,
    blur: shadow.blur,
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    opacity: shadow.opacity,
  };
}

/**
 * 图片 DSL 用极坐标（angle + distance）描述阴影；
 * RenderShadow 用直角坐标（offsetX/Y）。此函数统一转换。
 */
export function resolveImageVisualShadow(
  shadow: ImageVisualShadow | undefined | null
): RenderShadow | undefined {
  if (!shadow) return undefined;
  const angle = shadow.angle ?? 45;
  const distance = shadow.distance ?? 0;
  return {
    color: shadow.color ?? '#000000',
    blur: shadow.blur ?? 0,
    offsetX: Math.cos((angle * Math.PI) / 180) * distance,
    offsetY: Math.sin((angle * Math.PI) / 180) * distance,
    opacity: shadow.opacity,
  };
}

export function resolveAssetRef(ref: ImageSourceInput | undefined): RenderAssetRef {
  if (!ref) {
    return { type: 'external', url: '' };
  }

  const asset = resolveImageAsset(ref);
  switch (asset.kind) {
    case 'data_uri':
      return { type: 'data', dataUri: asset.dataUri };
    case 'local_file':
      return { type: 'embedded', partPath: asset.path };
  }
}

export function toRenderBox(box: Box): RenderBox {
  return { x: box.x, y: box.y, w: box.w, h: box.h, unit: 'in' };
}

export function makeBaseNode(
  id: string,
  box: RenderBox,
  zIndex: number,
  editableTarget?: EditableTarget,
  sourceSpan?: RenderSourceSpan,
  layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence,
): RenderBaseNode {
  return {
    id,
    box,
    zIndex,
    editableTarget,
    sourceSpan,
    layoutConstraintEvidence,
    rotation: undefined,
    opacity: undefined,
    visible: true,
  };
}

/**
 * GroupRenderNode children 坐标契约（B10 / CONTRACTS §4.7）：
 *
 *   GroupRenderNode.children[*].box = 相对父 group origin 的英寸偏移
 *
 * 上游 imported / generated 主链在递归映射时统一产出 slide 全局绝对坐标
 * （便于内部 transform 累计计算），但渲染端 Konva `<v-group>` / 离屏 `Konva.Group`
 * 会把 group.box.x/y 作为 transform 容器原点，children 再用绝对坐标会导致
 * "group offset + child absolute = 双重叠加" —— 只有 group.box 在 (0,0) 时不暴露。
 *
 * 这里在 mapper 边界一次性把 children 转成相对坐标，让所有下游消费方都按
 * Konva 的"group as transform container"语义处理。
 *
 * **嵌套 group**：本函数只 relativize **直接 children**（不递归进入子 group 的 children），
 * 因为子 group 自己在被 mapGroupNode/mapFreeformGroup 构造时已经走过一次 relativize；
 * 这里只要把子 group 自己的 box 从绝对调整到相对父，子 group 的 children 已经是
 * 相对自身的偏移，无需再处理。
 *
 * imported / generated / patched 三路在 mapper 出口统一调用此函数，保证 contract。
 */
export function relativizeGroupChildren(group: GroupRenderNode): GroupRenderNode {
  return {
    ...group,
    children: group.children.map(child => {
      const relativeBox = {
        ...child.box,
        x: child.box.x - group.box.x,
        y: child.box.y - group.box.y,
      };
      return { ...child, box: relativeBox };
    }),
  };
}
