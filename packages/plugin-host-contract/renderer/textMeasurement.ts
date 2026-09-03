import type {
  TextMeasureAdapter,
  TextMeasureInput,
  TextMeasureResult,
  TextMeasureWrapMode,
} from '../backend/textMeasurement';

export interface FontResolution {
  readonly requestedFamily?: string;
  readonly primaryFamily: string;
  readonly resolvedFamily: string;
  readonly requestedAvailable: boolean;
  readonly resolvedPrimaryAvailable: boolean;
  readonly fallbackFamilies: readonly string[];
}

export interface FontResolutionOptions {
  readonly sampleText?: string;
}

export interface RendererTextMeasureServicePort {
  prewarm(inputs: readonly TextMeasureInput[]): Promise<void>;
  measure(input: TextMeasureInput): TextMeasureResult;
}

export type {
  TextMeasureAdapter,
  TextMeasureInput,
  TextMeasureResult,
  TextMeasureWrapMode,
};

export declare function getRendererTextMeasureService(): RendererTextMeasureServicePort;
export declare function resolveRendererFont(
  requestedFamily?: string,
  options?: FontResolutionOptions,
): FontResolution;
export declare function resolveRendererFontFamily(
  requestedFamily?: string,
  options?: FontResolutionOptions,
): string;
