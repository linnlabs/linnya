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
 * 为 Yoga 暂估没有横向约束的 Text。Worker 不访问系统字体，wrap:none 下探测
 * 宽度不参与断行；Backend 落库前由 engine/text/materializeIntrinsicTextBoxes
 * 用最终排版同源的字形测量物化外框。本结果必须包含默认 inset，但不是持久化宽度。
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
 * 为 Yoga 流布局提供同步估高；实际 adapter 由当前运行域装配。
 * 无横向约束的绝对定位 Text 还会经过 Backend 同源尺寸物化，不能用这里判断最终测量来源。
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
