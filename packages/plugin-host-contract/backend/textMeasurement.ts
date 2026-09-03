export type TextMeasureSourceKind = 'generated' | 'imported' | 'ui-runtime';
export type TextMeasureWrapMode = 'word' | 'char' | 'none';

export interface TextMeasurePadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface TextMeasureStyle {
  readonly fontFamily?: string;
  readonly fontSizePt: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly lineHeightMultiplier?: number;
  readonly letterSpacingPt?: number;
}

export interface TextMeasureParagraph {
  readonly text: string;
  readonly indentInches?: number;
  readonly spacingBeforePt?: number;
  readonly spacingAfterPt?: number;
}

export interface TextMeasureBox {
  readonly widthInches: number;
  readonly heightInches?: number;
  readonly padding?: Partial<TextMeasurePadding>;
  readonly wrap?: TextMeasureWrapMode;
}

export interface TextMeasureInput {
  readonly paragraphs: TextMeasureParagraph[];
  readonly style: TextMeasureStyle;
  readonly box: TextMeasureBox;
  readonly sourceKind: TextMeasureSourceKind;
}

export interface ClusterAdvanceRequest {
  readonly clusters: readonly string[];
  readonly style: TextMeasureStyle;
  readonly sourceKind: TextMeasureSourceKind;
}

export type TextMeasureAdvanceSource = 'pretext' | 'heuristic' | 'harfbuzz';

export interface ClusterAdvanceMeasureResult {
  readonly advances: readonly number[];
  readonly source: TextMeasureAdvanceSource;
}

export interface TextMeasureLine {
  readonly text?: string;
  readonly widthInches: number;
}

export interface TextMeasureResult {
  readonly lineCount: number;
  readonly contentHeightInches: number;
  readonly totalHeightInches: number;
  readonly maxLineWidthInches: number;
  readonly lines?: TextMeasureLine[];
  readonly usedFallback: boolean;
  readonly warnings: string[];
  readonly fitsWidth?: boolean;
  readonly fitsHeight?: boolean;
}

export interface NormalizedTextMeasureInput extends TextMeasureInput {
  readonly box: TextMeasureBox & {
    readonly wrap: TextMeasureWrapMode;
    readonly padding: TextMeasurePadding;
    readonly usableWidthInches: number;
    readonly usableHeightInches?: number;
  };
}

export interface TextMeasureAdapter {
  readonly kind: string;
  measure(input: NormalizedTextMeasureInput): TextMeasureResult;
  prewarm?(inputs: readonly NormalizedTextMeasureInput[]): Promise<void>;
  measureClusterAdvances?(request: ClusterAdvanceRequest): number[];
  measureClusterAdvancesWithSource?(request: ClusterAdvanceRequest): ClusterAdvanceMeasureResult;
  prewarmClusterAdvances?(requests: readonly ClusterAdvanceRequest[]): Promise<void>;
}

export interface PluginTextMeasureServicePort {
  prewarm(inputs: readonly TextMeasureInput[]): Promise<void>;
  measure(input: TextMeasureInput): TextMeasureResult;
  prewarmClusterAdvances(requests: readonly ClusterAdvanceRequest[]): Promise<void>;
  measureClusterAdvances(request: ClusterAdvanceRequest): number[];
  measureClusterAdvancesWithSource(request: ClusterAdvanceRequest): ClusterAdvanceMeasureResult;
  getPrimaryAdapter(): TextMeasureAdapter;
}

export declare const defaultTextMeasureService: PluginTextMeasureServicePort;
export declare function emuToInches(emu: number): number;

/** 仅供 standalone backend process 持有确定性系统文本测量生命周期。 */
export interface PluginSystemTextMeasurementRuntime {
  initialize(): Promise<void>;
  dispose(): void;
}

export declare function createSystemTextMeasurementRuntime(): PluginSystemTextMeasurementRuntime;
