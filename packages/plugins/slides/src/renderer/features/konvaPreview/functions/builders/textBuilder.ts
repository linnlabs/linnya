import type { RenderTextRun, TextRenderNode } from '../../../../types/render';
import type { RenderLineSlice } from '@plugin/slides/shared';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import {
  resolveRenderableFontFamily,
} from '../konvaText';

const POINTS_TO_PX = INCHES_TO_PX / 72;

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
}

export function buildTextGroupConfig(node: TextRenderNode) {
  const config = {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
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
  const appliedFontScale = node.layout.appliedFontScale;
  const configs: TextLineConfig[] = [];

  for (const line of node.layout.lines) {
    for (const slice of line.slices) {
      if (slice.kind === 'inlineBox') continue;
      const style = resolveLayoutSliceStyle(node, slice);
      const text = slice.text;
      const fontSize = (style.fontSize ?? 14) * appliedFontScale * POINTS_TO_PX;
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
  if ((run.resolvedFontStyle ?? run.fontStyle) === 'italic') parts.push('italic');
  if ((run.resolvedFontWeight ?? run.fontWeight) === 'bold') parts.push('bold');
  return parts.length > 0 ? parts.join(' ') : 'normal';
}

function resolveTextDecoration(run: RenderTextRun): string | undefined {
  const decorations: string[] = [];
  if (run.underline) decorations.push('underline');
  if (run.strikethrough) decorations.push('line-through');
  return decorations.length > 0 ? decorations.join(' ') : undefined;
}
