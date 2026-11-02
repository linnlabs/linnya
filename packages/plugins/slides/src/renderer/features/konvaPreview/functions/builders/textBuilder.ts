import { resolveBoxRotation } from '@plugin/slides/shared/render-geometry';
import type { RenderTextRun, TextRenderNode } from '../../../../types/render';
import type { RenderLineSlice, VerticalGlyphRun } from '@plugin/slides/shared';
import { resolveVerticalLineColumn } from '@plugin/slides/shared/textLayout';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import {
  resolveRenderableFontFamily,
} from '../konvaText';

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

export function buildTextGroupConfig(node: TextRenderNode) {
  const config = {
    ...resolveBoxRotation(node.box, node.rotation, INCHES_TO_PX),
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
  if (node.overflow !== 'visible') {
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

export function buildTextLineConfigs(node: TextRenderNode): TextLineConfig[] {
  if (node.layout == null) {
    throw new Error(`TextRenderNode ${node.id} is missing shared text layout.`);
  }
  const padTop = (node.padding?.top ?? 0) * INCHES_TO_PX;
  const padLeft = (node.padding?.left ?? 0) * INCHES_TO_PX;
  const contentWidth = node.box.w - (node.padding?.left ?? 0) - (node.padding?.right ?? 0);
  const appliedFontScale = node.layout.appliedFontScale;
  const configs: TextLineConfig[] = [];

  for (const line of node.layout.lines) {
    for (const slice of line.slices) {
      if (slice.kind === 'inlineBox') continue;
      const style = resolveLayoutSliceStyle(node, slice);
      const text = slice.text;
      const fontSize = (style.fontSize ?? 14) * appliedFontScale * POINTS_TO_PX;
      if (slice.verticalGlyphRuns) {
        const column = resolveVerticalLineColumn(line, contentWidth);
        const columnCenter = padLeft + (column.x + column.width / 2) * INCHES_TO_PX;
        for (const glyph of slice.verticalGlyphRuns) {
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
