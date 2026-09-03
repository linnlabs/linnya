import type PptxGenJS from 'pptxgenjs';
import {
  resolveTextLayoutContract,
  type Box,
  type TextAutoFitPolicy,
  type TextBoxInsets,
  type TextLayoutContract,
  type TextLayoutProfile,
  type TextWrapPolicy,
} from '@plugin/slides/shared';

const POINTS_PER_INCH = 72;

export type PptxTextLayoutOptions = Pick<PptxGenJS.TextPropsOptions, 'fit' | 'wrap' | 'margin'>;

export function mapTextLayoutContractToPptxTextOptions(
  contract: TextLayoutContract,
): PptxTextLayoutOptions {
  return {
    fit: mapAutoFitPolicy(contract.autoFitPolicy),
    wrap: contract.wrap !== 'none',
    // PptxGenJS 4.0.1 的 TextPropsOptions.margin 虽在类型注释里写 TRBL，
    // 实际写 OOXML 时按 [left, right, bottom, top] 映射到 lIns/rIns/bIns/tIns。
    // 这里按实际写出语义适配，并由 compiler OOXML 测试锁住。
    margin: [
      inchesToPoints(contract.padding.left),
      inchesToPoints(contract.padding.right),
      inchesToPoints(contract.padding.bottom),
      inchesToPoints(contract.padding.top),
    ],
  };
}

/** 生成链路唯一的 PPTX 文本布局入口，避免两个 compiler 各自重建默认契约。 */
export function resolveGeneratedPptxTextLayoutOptions(
  box: Box,
  autoFitPolicy: TextAutoFitPolicy,
  profile: TextLayoutProfile,
  layoutOverrides: {
    padding?: TextBoxInsets;
    wrap?: TextWrapPolicy;
  } = {},
): PptxTextLayoutOptions {
  return mapTextLayoutContractToPptxTextOptions(resolveTextLayoutContract({
    profile,
    sourceKind: 'generated',
    box,
    padding: layoutOverrides.padding,
    wrap: layoutOverrides.wrap,
    autoFitPolicy,
  }));
}

function mapAutoFitPolicy(
  policy: TextLayoutContract['autoFitPolicy'],
): NonNullable<PptxTextLayoutOptions['fit']> {
  switch (policy) {
    case 'shrink-text':
      return 'shrink';
    case 'resize-shape':
      return 'resize';
    case 'none':
      return 'none';
  }
}

function inchesToPoints(value: number): number {
  return Number((value * POINTS_PER_INCH).toFixed(3));
}
