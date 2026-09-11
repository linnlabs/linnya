import { createRadialGradientScene } from '../radialGradientScene';
import type { ShapeConfig } from 'konva/lib/Shape';
import type { EllipseConfig } from 'konva/lib/shapes/Ellipse';
import type { LineConfig } from 'konva/lib/shapes/Line';
import type { PathConfig } from 'konva/lib/shapes/Path';
import type { RectConfig } from 'konva/lib/shapes/Rect';
import type { ShapeRenderNode, TextRenderNode } from '../../../../types/render';
import {
  resolvePresetShapePath,
  serializeShapePath,
  shapePathToPointArray,
  type ResolvedPathShapeGeometry,
} from '@plugin/slides/shared/shapeGeometry';
import { INCHES_TO_PX } from '../../../../shared/constants';
import {
  resolveKonvaShapeFillConfig,
  resolveKonvaShapeStrokeConfig,
  type KonvaShapeFillConfig,
  type KonvaShapeStrokeConfig,
} from '../konvaVisualMapping';

/** Konva 原语种类。Vue 侧映射成 `v-${primitive}`，离屏侧映射成对应的 Konva 类。 */
export type KonvaShapePrimitive = 'rect' | 'ellipse' | 'line' | 'path';

/** Shape 渲染指令：把"语义形状 → 几何配置"的全部决策集中成一份纯数据。 */
export type KonvaShapeRenderInstruction =
  | { primitive: 'rect'; config: RectConfig }
  | { primitive: 'ellipse'; config: EllipseConfig }
  | { primitive: 'line'; config: LineConfig & { points: number[] } }
  | { primitive: 'path'; config: PathConfig & { data: string } };

type KonvaShapeVisualConfig = KonvaShapeFillConfig & KonvaShapeStrokeConfig & Pick<
  ShapeConfig,
  | 'strokeWidth'
  | 'dash'
  | 'shadowColor'
  | 'shadowBlur'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
  | 'shadowOpacity'
  | 'shadowEnabled'
>;

/**
 * OOXML `roundRect` preset geometry 的默认 adjustment。
 *
 * 资料显示其默认值为 `16667 / 100000`，即 short side 的约 1/6。
 * 这里直接按 short side 还原，避免再用拍脑袋的视觉经验值。
 */
const PPT_ROUND_RECT_DEFAULT_ADJUSTMENT = 16667 / 100000;
const POINTS_TO_PX = INCHES_TO_PX / 72;

export function buildShapeGroupConfig(node: ShapeRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    // ShapeStyle.opacity 是填充透明度，不应连带淡化描边和形状内文本。
    opacity: 1,
    visible: node.visible !== false,
  };
}

/**
 * 把 ShapeRenderNode 翻译成 Konva 原语 + 配置。
 *
 * 这是 Vue 主预览与离屏缩略图共享的唯一形状分发入口；
 * 任何“geometry 用什么原语”的判断都应该改这里、不要在调用方再分支。
 */
export function buildShapeRenderInstruction(node: ShapeRenderNode): KonvaShapeRenderInstruction {
  const instruction = buildBaseShapeRenderInstruction(node);
  if (node.fill?.type !== 'radial') return instruction;
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  Object.assign(instruction.config, createRadialGradientScene(node.fill, width, height, () => {
    const path = new Path2D();
    switch (instruction.primitive) {
      case 'ellipse': path.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2); break;
      case 'rect': path.roundRect(0, 0, width, height, instruction.config.cornerRadius ?? 0); break;
      case 'path': return new Path2D(instruction.config.data);
      case 'line': {
        const points = instruction.config.points;
        path.moveTo(points[0], points[1]);
        for (let index = 2; index < points.length; index += 2) path.lineTo(points[index], points[index + 1]);
        if (instruction.config.closed) path.closePath();
        break;
      }
    }
    return path;
  }, node.opacity, instruction.primitive === 'ellipse' ? { x: -width / 2, y: -height / 2 } : undefined));
  return instruction;
}

function buildBaseShapeRenderInstruction(node: ShapeRenderNode): KonvaShapeRenderInstruction {
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  const origin = node.geometry.type === 'preset' && node.geometry.name === 'ellipse'
    ? { x: -width / 2, y: -height / 2 } : { x: 0, y: 0 };
  const fillConfig = node.fill?.type === 'radial' ? {}
    : resolveKonvaShapeFillConfig(node.fill, width, height, node.opacity, origin);
  const strokeConfig = buildStrokeConfig(node);
  const shadowConfig = buildShadowConfig(node);
  const baseVisual = {
    ...fillConfig,
    ...strokeConfig,
    ...shadowConfig,
  };

  if (node.geometry.type === 'path') {
    return buildPathInstruction(node.geometry, width, height, baseVisual);
  }

  switch (node.geometry.name) {
    case 'ellipse':
      return {
        primitive: 'ellipse',
        config: {
          ...baseVisual,
          x: width / 2,
          y: height / 2,
          radiusX: width / 2,
          radiusY: height / 2,
        },
      };

    case 'line':
      return buildLineInstruction(width, height, baseVisual);
    case 'roundRect':
      return rectInstruction(node, width, height, baseVisual, /* roundRectMode */ true);
    case 'rect':
      return rectInstruction(node, width, height, baseVisual, /* roundRectMode */ false);
    default: {
      const path = resolvePresetShapePath(node.geometry.name);
      if (!path) {
        throw new Error(`preset geometry ${node.geometry.name} 缺少 Konva adapter。`);
      }
      return buildPathInstruction(path, width, height, baseVisual);
    }
  }
}

export function buildInnerTextNode(node: ShapeRenderNode): TextRenderNode {
  if (!node.innerText) {
    throw new Error('buildInnerTextNode requires node.innerText');
  }

  return {
    ...node.innerText,
    box: {
      x: node.innerText.box.x - node.box.x,
      y: node.innerText.box.y - node.box.y,
      w: node.innerText.box.w,
      h: node.innerText.box.h,
      unit: 'in',
    },
  };
}

function rectInstruction(
  node: ShapeRenderNode,
  width: number,
  height: number,
  baseVisual: KonvaShapeVisualConfig,
  roundRectMode: boolean,
): Extract<KonvaShapeRenderInstruction, { primitive: 'rect' }> {
  const cornerRadius = resolveCornerRadius(node, width, height, roundRectMode);
  return {
    primitive: 'rect',
    config: {
      ...baseVisual,
      x: 0,
      y: 0,
      width,
      height,
      cornerRadius,
    },
  };
}

function buildLineInstruction(
  width: number,
  height: number,
  baseVisual: KonvaShapeVisualConfig,
): Extract<KonvaShapeRenderInstruction, { primitive: 'line' }> {
  return {
    primitive: 'line',
    config: {
      ...baseVisual,
      points: [0, 0, width, height],
      closed: false,
    },
  };
}

function buildPathInstruction(
  geometry: ResolvedPathShapeGeometry,
  width: number,
  height: number,
  baseVisual: KonvaShapeVisualConfig,
): KonvaShapeRenderInstruction {
  const points = shapePathToPointArray(geometry, width, height);
  if (points) {
    return pathPointsInstruction(points, geometry.closed, baseVisual);
  }
  return {
    primitive: 'path',
    config: {
      ...baseVisual,
      x: 0,
      y: 0,
      data: serializeShapePath(geometry, width, height),
    },
  };
}

function pathPointsInstruction(
  points: number[],
  closed: boolean,
  baseVisual: KonvaShapeVisualConfig,
): Extract<KonvaShapeRenderInstruction, { primitive: 'line' }> {
  return {
    primitive: 'line',
    config: {
      ...baseVisual,
      points,
      closed,
    },
  };
}

/**
 * 把 ShapeStyle.borderRadius / ShapeRenderNode.cornerRadius 翻译成 Konva 的 px 圆角。
 *
 * 单位约定（与 PptxGenJS `rectRadius` 完全一致）：
 *   - `node.cornerRadius` 单位 = 英寸（inches），与 slide 物理坐标同一量纲；
 *   - PptxGenJS 内部公式：`adj = round(rectRadius × EMU × 100000 / min(cx_emu, cy_emu))`，
 *     等价于 `(rectRadius_in × 100000) / min(cx_in, cy_in)`，
 *     即"圆角直径 / 短边"的 100000ths；当 rectRadius_in ≥ short_side / 2 时
 *     adj 会达到 OOXML 上限 50000 → 渲染为完美胶囊（pill）。
 *   - 所以前端只需 `× INCHES_TO_PX` 转 px，再 cap 到 short_side / 2 即可与 PPT 严格对齐。
 *
 * 默认 roundRect（无 cornerRadius）回退到 OOXML preset 默认 adj = 16667/100000，
 * 即 short_side × 1/6，避免与 PowerPoint 默认效果不一致。
 */
function resolveCornerRadius(
  node: ShapeRenderNode,
  width: number,
  height: number,
  roundRectMode: boolean,
): number {
  const shortSidePx = Math.min(width, height);
  const halfShortSidePx = shortSidePx / 2;

  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    const radiusPx = node.cornerRadius * INCHES_TO_PX;
    return Math.min(radiusPx, halfShortSidePx);
  }
  if (!roundRectMode) {
    return 0;
  }
  return shortSidePx * PPT_ROUND_RECT_DEFAULT_ADJUSTMENT;
}

function buildStrokeConfig(
  node: ShapeRenderNode,
): KonvaShapeStrokeConfig & Pick<KonvaShapeVisualConfig, 'strokeWidth' | 'dash'> {
  const stroke = node.stroke;
  if (!stroke) return {};
  return {
    ...resolveKonvaShapeStrokeConfig(
      stroke.paint,
      node.box.w * INCHES_TO_PX,
      node.box.h * INCHES_TO_PX,
      node.geometry.type === 'preset' && node.geometry.name === 'ellipse'
        ? { x: -node.box.w * INCHES_TO_PX / 2, y: -node.box.h * INCHES_TO_PX / 2 } : undefined,
    ),
    strokeWidth: stroke.width * POINTS_TO_PX,
    dash: stroke.dash === 'dash' ? [8, 4] : stroke.dash === 'dot' ? [2, 4] : undefined,
  };
}

function buildShadowConfig(
  node: ShapeRenderNode,
): Pick<
  KonvaShapeVisualConfig,
  'shadowColor' | 'shadowBlur' | 'shadowOffsetX' | 'shadowOffsetY' | 'shadowOpacity' | 'shadowEnabled'
> {
  const shadow = node.shadow;
  if (!shadow) return {};
  return {
    shadowColor: shadow.color,
    shadowBlur: shadow.blur * POINTS_TO_PX,
    shadowOffsetX: shadow.offsetX * POINTS_TO_PX,
    shadowOffsetY: shadow.offsetY * POINTS_TO_PX,
    shadowOpacity: shadow.opacity ?? 0.3,
    shadowEnabled: true,
  };
}
