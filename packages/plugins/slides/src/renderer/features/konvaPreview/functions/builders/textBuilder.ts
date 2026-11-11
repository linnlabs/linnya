import { resolveBoxRotation } from '@plugin/slides/shared/render-geometry';
import type { RenderTextRun, TextRenderNode } from '../../../../types/render';
import type { RenderLineSlice, VerticalGlyphRun } from '@plugin/slides/shared';
import { resolveVerticalLineColumn } from '@plugin/slides/shared/textLayout';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import {
  resolveRenderableFontFamily,
} from '../konvaText';
import {
  resolveKonvaShapeFillConfig,
  resolveKonvaShapeStrokeConfig,
  type KonvaShapeFillConfig,
} from '../konvaVisualMapping';
import { DEFAULT_SHADOW_OPACITY } from '@plugin/slides/shared/renderModel';
import { toKonvaShadowBlur } from './shapeBuilder';

const POINTS_TO_PX = INCHES_TO_PX / 72;
/** 横排字形的逗号句号在字格左下，竖排应移到右上。 */
const CORNER_PUNCTUATION_SHIFT_EM = 0.6;

export interface TextLineConfig {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  fill: string;
  width?: number;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  wrap: 'word' | 'char' | 'none';
  ellipsis: boolean;
  letterSpacing?: number;
  textDecoration?: string;
  rotation?: number;
}

/** 字形效果落到每段 Konva Text 上的属性；渐变坐标换算到所在行的文字外框。 */
type TextEffectConfig = KonvaShapeFillConfig & {
  fillEnabled?: boolean;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  shadowEnabled?: boolean;
};

export function buildTextGroupConfig(node: TextRenderNode) {
  const config = {
    ...resolveBoxRotation(node.box, node.rotation, INCHES_TO_PX),
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
  // 投影和描边会伸出字形，按文本框裁剪会把它们切掉（PowerPoint 不裁）。
  const effects = node.textEffects;
  if (node.overflow !== 'visible' && !effects?.shadow && !effects?.stroke) {
    return {
      ...config,
      // padding 决定断行与文字起点，但不是字形裁剪边界。PowerPoint 允许超宽
      // 字形进入 padding；真正的 overflow 只在文本框外边界发生。
      clipX: 0,
      clipY: 0,
      clipWidth: node.box.w * INCHES_TO_PX,
      clipHeight: node.box.h * INCHES_TO_PX,
    };
  }
  return config;
}

export function buildTextLineConfigs(node: TextRenderNode): Array<TextLineConfig & TextEffectConfig> {
  const lineIndexes: number[] = [];
  const configs = buildPlainTextLineConfigs(node, lineIndexes);
  if (!node.textEffects) return configs;
  return configs.map((config, index) => ({
    ...config,
    ...buildTextEffectConfig(node, config, resolveGradientBox(node, lineIndexes[index])),
  }));
}

interface PixelBox { x: number; y: number; width: number; height: number }

/**
 * PowerPoint 的字形渐变按每一行文字的外框铺：多段 run 在一行里共用一条，居中时只铺文字本身，
 * 换行后下一行重新开始（2026-11-11 PowerPoint 实测 0°、45°、90°）。竖排没有实测，铺整个内容区。
 */
function resolveGradientBox(node: TextRenderNode, lineIndex: number): PixelBox {
  const padLeft = (node.padding?.left ?? 0) * INCHES_TO_PX;
  const padTop = (node.padding?.top ?? 0) * INCHES_TO_PX;
  const line = node.layout?.lines[lineIndex];
  const slices = line?.slices.filter((slice) => slice.kind !== 'inlineBox' && !slice.verticalGlyphRuns) ?? [];
  if (!line || slices.length === 0) {
    return { x: 0, y: 0, width: node.box.w * INCHES_TO_PX, height: node.box.h * INCHES_TO_PX };
  }
  const start = Math.min(...slices.map((slice) => slice.x));
  const end = Math.max(...slices.map((slice) => slice.x + slice.width));
  return {
    x: padLeft + start * INCHES_TO_PX,
    y: padTop + line.y * INCHES_TO_PX,
    width: Math.max((end - start) * INCHES_TO_PX, 1),
    height: Math.max(line.height * INCHES_TO_PX, 1),
  };
}

/**
 * 每段 Text 的局部坐标原点在它自己的 x/y，所以把所在行的渐变轴平移到段内。
 * 不透明度只乘到字形填充和描边上，不影响投影。
 */
function buildTextEffectConfig(node: TextRenderNode, line: TextLineConfig, box: PixelBox): TextEffectConfig {
  const effects = node.textEffects!;
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  const config: TextEffectConfig = {};
  if (effects.fill?.type === 'none') {
    config.fillEnabled = false;
  } else if (effects.fill?.type === 'linear') {
    const origin = { x: box.x - line.x, y: box.y - line.y };
    Object.assign(config, { fill: undefined }, resolveKonvaShapeFillConfig(effects.fill, box.width, box.height, effects.opacity, origin));
  } else if (effects.opacity != null) {
    Object.assign(config, resolveKonvaShapeFillConfig({ type: 'solid', color: line.fill }, width, height, effects.opacity));
  }
  if (effects.stroke) {
    Object.assign(config, resolveKonvaShapeStrokeConfig({ type: 'solid', color: effects.stroke.color, opacity: effects.opacity }, width, height));
    config.strokeWidth = effects.stroke.width * POINTS_TO_PX;
  }
  if (effects.shadow) {
    config.shadowColor = effects.shadow.color;
    config.shadowBlur = toKonvaShadowBlur(effects.shadow.blur);
    config.shadowOffsetX = effects.shadow.offsetX * POINTS_TO_PX;
    config.shadowOffsetY = effects.shadow.offsetY * POINTS_TO_PX;
    config.shadowOpacity = effects.shadow.opacity ?? DEFAULT_SHADOW_OPACITY;
    config.shadowEnabled = true;
  }
  return config;
}

function buildPlainTextLineConfigs(node: TextRenderNode, lineIndexes: number[] = []): TextLineConfig[] {
  if (node.layout == null) {
    throw new Error(`TextRenderNode ${node.id} is missing shared text layout.`);
  }
  const padTop = (node.padding?.top ?? 0) * INCHES_TO_PX;
  const padLeft = (node.padding?.left ?? 0) * INCHES_TO_PX;
  const contentWidth = node.box.w - (node.padding?.left ?? 0) - (node.padding?.right ?? 0);
  const appliedFontScale = node.layout.appliedFontScale;
  const configs: TextLineConfig[] = [];

  for (const [lineIndex, line] of node.layout.lines.entries()) {
    for (const slice of line.slices) {
      if (slice.kind === 'inlineBox') continue;
      const style = resolveLayoutSliceStyle(node, slice);
      const text = slice.text;
      const fontSize = (style.fontSize ?? 14) * appliedFontScale * POINTS_TO_PX;
      if (slice.verticalGlyphRuns) {
        const column = resolveVerticalLineColumn(line, contentWidth);
        const columnCenter = padLeft + (column.x + column.width / 2) * INCHES_TO_PX;
        for (const glyph of slice.verticalGlyphRuns) {
          lineIndexes.push(lineIndex);
          configs.push({
            ...buildVerticalGlyphPlacement(glyph, columnCenter, padTop + (slice.x + glyph.offset) * INCHES_TO_PX, fontSize),
            text: glyph.text,
            fontSize,
            fontFamily: style.resolvedFontFamily ?? resolveRenderableFontFamily(style.fontFamily, glyph.text),
            fontStyle: toKonvaFontStyle(style),
            fill: style.color ?? SLIDES_RENDER_COLORS.textFallbackFill,
            align: 'left',
            lineHeight: 1,
            wrap: 'none',
            ellipsis: false,
            // 直立字的步进已含字距；只有成段旋转的西文仍由画布逐字分配。
            letterSpacing: glyph.orientation !== 'rotated' || style.letterSpacing == null
              ? undefined
              : style.letterSpacing * appliedFontScale * POINTS_TO_PX,
          });
        }
        continue;
      }
      lineIndexes.push(lineIndex);
      configs.push({
        x: padLeft + slice.x * INCHES_TO_PX,
        y: padTop + slice.textY * INCHES_TO_PX,
        text,
        fontSize,
        fontFamily: style.resolvedFontFamily ?? resolveRenderableFontFamily(style.fontFamily, text),
        fontStyle: toKonvaFontStyle(style),
        fill: style.color ?? SLIDES_RENDER_COLORS.textFallbackFill,
        // 后端已经完成断行与对齐，slice.width 是排版 advance，不是字形 paint
        // 边界。普通行不再把它传给 Konva Text，否则启发式/字体版本带来的几
        // 个像素差会先在 run 内裁字，外层文本框的正式 overflow 边界反而失效。
        // justify 仍需要明确宽度才能让 Konva 分配词间距。
        ...(line.align === 'justify'
          ? {
              width: Math.max(slice.width * INCHES_TO_PX + 1, 1),
              align: 'justify' as const,
            }
          : { align: 'left' as const }),
        lineHeight: 1,
        wrap: 'none',
        ellipsis: false,
        letterSpacing: style.letterSpacing == null
          ? undefined
          : style.letterSpacing * appliedFontScale * POINTS_TO_PX,
        textDecoration: resolveTextDecoration(style),
      });
    }
  }

  return configs;
}

/** 字形中心落在列中轴；旋转段绕起点顺时针 90°，字身向左展开。 */
function buildVerticalGlyphPlacement(
  glyph: VerticalGlyphRun,
  columnCenter: number,
  y: number,
  fontSize: number,
): Pick<TextLineConfig, 'x' | 'y' | 'rotation'> {
  if (glyph.orientation === 'rotated') {
    return { x: columnCenter + fontSize / 2, y, rotation: 90 };
  }
  const x = columnCenter - fontSize / 2;
  return glyph.orientation === 'corner'
    ? { x: x + fontSize * CORNER_PUNCTUATION_SHIFT_EM, y: y - fontSize * CORNER_PUNCTUATION_SHIFT_EM }
    : { x, y };
}

function resolveLayoutSliceStyle(
  node: TextRenderNode,
  slice: RenderLineSlice,
): RenderTextRun {
  const paragraph = node.paragraphs[slice.paragraphIndex];
  const fallbackRun = paragraph?.runs.find((run) => 'text' in run) ?? { text: '' };
  if (slice.isBulletMarker) {
    return {
      ...fallbackRun,
      color: paragraph?.bullet?.color ?? fallbackRun.color,
      fontSize: paragraph?.bullet?.fontSize ?? fallbackRun.fontSize,
    };
  }
  const run = paragraph?.runs[slice.runIndex];
  return run && 'text' in run ? run : fallbackRun;
}

function toKonvaFontStyle(run: RenderTextRun): string {
  const parts: string[] = [];
  // resolved 样式描述底层字面，不能取消作者的强调；缺少对应字面时由浏览器合成。
  // 仍保留替代字面固有的强调，避免把已用粗体测量的替代字体重新声明成 regular。
  if (run.fontStyle === 'italic' || run.resolvedFontStyle === 'italic') parts.push('italic');
  if (run.fontWeight === 'bold' || run.resolvedFontWeight === 'bold') parts.push('bold');
  return parts.length > 0 ? parts.join(' ') : 'normal';
}

function resolveTextDecoration(run: RenderTextRun): string | undefined {
  const decorations: string[] = [];
  if (run.underline) decorations.push('underline');
  if (run.strikethrough) decorations.push('line-through');
  return decorations.length > 0 ? decorations.join(' ') : undefined;
}
