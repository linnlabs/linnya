export type TextMeasureSourceKind = 'generated' | 'imported' | 'ui-runtime';

export type TextMeasureWrapMode = 'word' | 'char' | 'none';

/** 平台文本测量归一化默认行高；具体业务合同可在自己的 domain 内声明同值语义常量。 */
export const DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER = 1.2;

export interface TextMeasurePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TextMeasureStyle {
  fontFamily?: string;
  fontSizePt: number;
  bold?: boolean;
  italic?: boolean;
  lineHeightMultiplier?: number;
  letterSpacingPt?: number;
}

export interface TextMeasureParagraph {
  text: string;
  indentInches?: number;
  spacingBeforePt?: number;
  spacingAfterPt?: number;
}

export interface TextMeasureBox {
  widthInches: number;
  heightInches?: number;
  padding?: Partial<TextMeasurePadding>;
  wrap?: TextMeasureWrapMode;
}

export interface TextMeasureInput {
  paragraphs: TextMeasureParagraph[];
  style: TextMeasureStyle;
  box: TextMeasureBox;
  sourceKind: TextMeasureSourceKind;
}

export interface ClusterAdvanceRequest {
  clusters: readonly string[];
  style: TextMeasureStyle;
  sourceKind: TextMeasureSourceKind;
}

export type TextMeasureAdvanceSource = 'pretext' | 'heuristic' | 'harfbuzz';

export interface ClusterAdvanceMeasureResult {
  advances: number[];
  source: TextMeasureAdvanceSource;
}

export interface TextMeasureLine {
  text?: string;
  widthInches: number;
}

export interface TextMeasureResult {
  lineCount: number;
  contentHeightInches: number;
  totalHeightInches: number;
  maxLineWidthInches: number;
  lines?: TextMeasureLine[];
  usedFallback: boolean;
  warnings: string[];
  fitsWidth?: boolean;
  fitsHeight?: boolean;
}

export interface TextMeasureFitOptions {
  preferredFontSizePt: number;
  minFontSizePt: number;
  stepPt?: number;
}

export interface TextMeasureFitResult {
  fontSizePt: number;
  measurement: TextMeasureResult;
}

export interface NormalizedTextMeasureInput {
  paragraphs: TextMeasureParagraph[];
  style: Required<Pick<TextMeasureStyle, 'fontSizePt' | 'lineHeightMultiplier' | 'bold' | 'italic'>> & Omit<TextMeasureStyle, 'fontSizePt' | 'lineHeightMultiplier' | 'bold' | 'italic'>;
  box: {
    widthInches: number;
    heightInches?: number;
    wrap: TextMeasureWrapMode;
    padding: TextMeasurePadding;
    usableWidthInches: number;
    usableHeightInches?: number;
  };
  sourceKind: TextMeasureSourceKind;
}

export interface NormalizedClusterAdvanceRequest {
  clusters: readonly string[];
  style: NormalizedTextMeasureInput['style'];
  sourceKind: TextMeasureSourceKind;
}

export interface ResolvedFontFile {
  readonly filePath: string;
  readonly faceIndex: number;
  readonly postscriptName: string;
}

export interface FontFileLocator {
  locate(request: {
    readonly family: string;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly script: 'latin' | 'eastAsian' | 'complex';
    /** 真实 shaping 文本；字体 adapter 用它完成逐字 cmap 覆盖解析。 */
    readonly text: string;
  }): ResolvedFontFile | undefined;
}

export interface TextMeasureClusterAdvanceProvider {
  readonly kind: string;
  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[];
  measureClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult;
  prewarmClusterAdvances?(requests: readonly NormalizedClusterAdvanceRequest[]): Promise<void>;
}

export interface TextMeasureAdapter {
  readonly kind: string;
  measure(input: NormalizedTextMeasureInput): TextMeasureResult;
  prewarm?(inputs: readonly NormalizedTextMeasureInput[]): Promise<void>;
  measureClusterAdvances?(request: NormalizedClusterAdvanceRequest): number[];
  measureClusterAdvancesWithSource?(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult;
  prewarmClusterAdvances?(requests: readonly NormalizedClusterAdvanceRequest[]): Promise<void>;
}
