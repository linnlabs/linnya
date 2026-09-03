import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import {
  DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
  PPTX_DEFAULT_TEXT_INSET,
} from '@plugin/slides/shared';
import type { LayoutTextNode } from './LayoutTypes.js';

const DEFAULT_FONT_SIZE = 10;

export interface IntrinsicTextBoxSize {
  widthInches: number;
  heightInches: number;
}

/**
 * 测量没有横向约束的 Text。wrap:none 下探测宽度不会参与断行；最终外框必须
 * 把 PowerPoint 默认文本边距一起计入，避免作者被迫猜测隐藏的可用宽度。
 */
export function measureIntrinsicTextBox(node: LayoutTextNode): IntrinsicTextBoxSize {
  const fontSize = node.fontSize ?? DEFAULT_FONT_SIZE;
  const lineSpacing = node.lineHeight
    ?? node.lineSpacing
    ?? DEFAULT_TEXT_LINE_SPACING_MULTIPLE;
  const content = typeof node.content === 'string'
    ? node.content
    : Array.isArray(node.content)
      ? node.content.map((run) => 'text' in run ? run.text : '').join('')
      : '';
  const measurement = defaultTextMeasureService.measure({
    paragraphs: [{ text: content }],
    style: {
      fontFamily: node.fontFamily,
      fontSizePt: fontSize,
      bold: node.fontWeight === 'bold'
        || (typeof node.fontWeight === 'number' && node.fontWeight >= 700)
        || node.bold === true,
      italic: node.fontStyle === 'italic' || node.italic === true,
      lineHeightMultiplier: lineSpacing,
      letterSpacingPt: node.letterSpacing,
    },
    box: {
      // wrap:none 时 adapter 只使用该值计算 fitsWidth，不会据此断行。
      widthInches: 1,
      wrap: 'none',
      padding: PPTX_DEFAULT_TEXT_INSET,
    },
    sourceKind: 'generated',
  });

  return {
    widthInches: measurement.maxLineWidthInches
      + PPTX_DEFAULT_TEXT_INSET.left
      + PPTX_DEFAULT_TEXT_INSET.right,
    heightInches: measurement.totalHeightInches,
  };
}

/**
 * 为 Yoga 文本节点提供统一的启发式估高入口。
 * 主进程当前仍走 fallback adapter，但调用面已经统一到 TextMeasureService。
 */
export function estimateTextHeight(
  content: string,
  widthIn: number,
  fontSize: number = DEFAULT_FONT_SIZE,
  lineSpacing: number = DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
  letterSpacing?: number,
): number {
  if (!content || widthIn <= 0) {
    return 0;
  }

  return defaultTextMeasureService.measure({
    paragraphs: [{ text: content }],
    style: {
      fontSizePt: fontSize,
      lineHeightMultiplier: lineSpacing,
      letterSpacingPt: letterSpacing,
    },
    box: {
      widthInches: widthIn,
      wrap: 'word',
    },
    sourceKind: 'generated',
  }).totalHeightInches;
}
