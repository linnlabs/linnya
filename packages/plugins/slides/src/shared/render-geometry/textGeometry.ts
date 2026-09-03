import type { TextWrapPolicy } from '../textLayout/definitions/contract';

export type RenderTextMeasureSourceKind = 'generated' | 'imported' | 'ui-runtime';

export interface RenderTextMeasureStyle {
  fontFamily?: string;
  fontSizePt: number;
  bold?: boolean;
  italic?: boolean;
  lineHeightMultiplier?: number;
  letterSpacingPt?: number;
}

export interface RenderTextMeasureParagraph {
  text: string;
  indentInches?: number;
  spacingBeforePt?: number;
  spacingAfterPt?: number;
}

export interface RenderTextMeasurePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RenderTextMeasureBox {
  widthInches: number;
  heightInches?: number;
  padding?: Partial<RenderTextMeasurePadding>;
  wrap?: TextWrapPolicy;
}

export interface RenderTextMeasureInput {
  paragraphs: RenderTextMeasureParagraph[];
  style: RenderTextMeasureStyle;
  box: RenderTextMeasureBox;
  sourceKind: RenderTextMeasureSourceKind;
}

export interface RenderTextMeasureLine {
  text?: string;
  widthInches: number;
}

export interface RenderTextMeasureResult {
  lineCount: number;
  contentHeightInches: number;
  totalHeightInches: number;
  maxLineWidthInches: number;
  lines?: RenderTextMeasureLine[];
  usedFallback: boolean;
  warnings: string[];
  fitsWidth?: boolean;
  fitsHeight?: boolean;
}

export interface RenderTextMeasurePort {
  measure(input: RenderTextMeasureInput): RenderTextMeasureResult;
}
