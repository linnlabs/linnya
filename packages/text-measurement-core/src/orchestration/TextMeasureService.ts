import { HeuristicMeasureAdapter } from '../adapters/HeuristicMeasureAdapter.js';
import type {
  ClusterAdvanceMeasureResult,
  NormalizedTextMeasureInput,
  NormalizedClusterAdvanceRequest,
  ClusterAdvanceRequest,
  TextMeasureAdvanceSource,
  TextMeasureAdapter,
  TextMeasureClusterAdvanceProvider,
  TextMeasureFitOptions,
  TextMeasureFitResult,
  TextMeasureInput,
  TextMeasurePadding,
  TextMeasureResult,
  TextMeasureStyle,
} from '../definitions/types.js';
import { DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER } from '../definitions/types.js';

const DEFAULT_PADDING: TextMeasurePadding = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function normalizeStyle(style: TextMeasureStyle): NormalizedTextMeasureInput['style'] {
  return {
    ...style,
    fontSizePt: style.fontSizePt,
    lineHeightMultiplier: style.lineHeightMultiplier ?? DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER,
    bold: style.bold ?? false,
    italic: style.italic ?? false,
  };
}

export function normalizeTextMeasureInput(input: TextMeasureInput): NormalizedTextMeasureInput {
  const padding = {
    ...DEFAULT_PADDING,
    ...input.box.padding,
  };
  const usableWidthInches = Math.max(0.01, input.box.widthInches - padding.left - padding.right);
  const usableHeightInches = input.box.heightInches == null
    ? undefined
    : Math.max(0, input.box.heightInches - padding.top - padding.bottom);

  return {
    paragraphs: input.paragraphs.length > 0 ? input.paragraphs : [{ text: '' }],
    style: normalizeStyle(input.style),
    box: {
      widthInches: input.box.widthInches,
      heightInches: input.box.heightInches,
      wrap: input.box.wrap ?? 'word',
      padding,
      usableWidthInches,
      usableHeightInches,
    },
    sourceKind: input.sourceKind,
  };
}

export function normalizeClusterAdvanceRequest(
  request: ClusterAdvanceRequest,
): NormalizedClusterAdvanceRequest {
  return {
    clusters: [...request.clusters],
    style: normalizeStyle(request.style),
    sourceKind: request.sourceKind,
  };
}

export class TextMeasureService {
  private primary: TextMeasureAdapter;
  private fallback: TextMeasureAdapter;
  private clusterAdvanceProvider: TextMeasureClusterAdvanceProvider | null;
  private readonly defaultPrimary: TextMeasureAdapter;
  private readonly defaultFallback: TextMeasureAdapter;
  private readonly defaultClusterAdvanceProvider: TextMeasureClusterAdvanceProvider | null;

  constructor(options?: {
    primary?: TextMeasureAdapter;
    fallback?: TextMeasureAdapter;
    clusterAdvanceProvider?: TextMeasureClusterAdvanceProvider | null;
  }) {
    const heuristic = new HeuristicMeasureAdapter();
    this.defaultPrimary = options?.primary ?? heuristic;
    this.defaultFallback = options?.fallback ?? heuristic;
    this.defaultClusterAdvanceProvider = options?.clusterAdvanceProvider ?? null;
    this.primary = this.defaultPrimary;
    this.fallback = this.defaultFallback;
    this.clusterAdvanceProvider = this.defaultClusterAdvanceProvider;
  }

  measure(input: TextMeasureInput): TextMeasureResult {
    const normalized = normalizeTextMeasureInput(input);
    try {
      return this.primary.measure(normalized);
    } catch (error) {
      const fallbackResult = this.fallback.measure(normalized);
      const message = error instanceof Error ? error.message : 'Unknown text measurement failure';
      return {
        ...fallbackResult,
        usedFallback: true,
        warnings: [...fallbackResult.warnings, message],
      };
    }
  }

  measureClusterAdvances(request: ClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(request: ClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    const normalized = normalizeClusterAdvanceRequest(request);
    if (this.clusterAdvanceProvider != null) {
      try {
        const result = this.clusterAdvanceProvider.measureClusterAdvancesWithSource(normalized);
        if (result.source !== 'heuristic') {
          return result;
        }
      } catch {
        // cluster provider 是窄能力加速层；失败时回到既有 primary/fallback 权威链路。
      }
    }

    try {
      if (this.primary.measureClusterAdvancesWithSource != null) {
        return this.primary.measureClusterAdvancesWithSource(normalized);
      }
      if (this.primary.measureClusterAdvances != null) {
        return {
          advances: this.primary.measureClusterAdvances(normalized),
          source: resolveAdapterAdvanceSource(this.primary.kind),
        };
      }
      return this.fallbackClusterAdvancesWithSource(normalized);
    } catch {
      return this.fallbackClusterAdvancesWithSource(normalized);
    }
  }

  async prewarm(inputs: readonly TextMeasureInput[]): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    await this.prewarmNormalized(inputs.map((input) => normalizeTextMeasureInput(input)));
  }

  async prewarmNormalized(inputs: readonly NormalizedTextMeasureInput[]): Promise<void> {
    if (inputs.length === 0 || this.primary.prewarm == null) {
      return;
    }
    await this.primary.prewarm(inputs);
  }

  async prewarmClusterAdvances(requests: readonly ClusterAdvanceRequest[]): Promise<void> {
    if (requests.length === 0) {
      return;
    }
    const normalized = requests.map((request) => normalizeClusterAdvanceRequest(request));
    if (this.clusterAdvanceProvider?.prewarmClusterAdvances != null) {
      await this.clusterAdvanceProvider.prewarmClusterAdvances(normalized);
      return;
    }
    if (this.primary.prewarmClusterAdvances != null) {
      await this.primary.prewarmClusterAdvances(normalized);
    }
  }

  configureAdapters(options: {
    primary?: TextMeasureAdapter;
    fallback?: TextMeasureAdapter;
    clusterAdvanceProvider?: TextMeasureClusterAdvanceProvider | null;
  }): void {
    if (options.primary != null) {
      this.primary = options.primary;
    }
    if (options.fallback != null) {
      this.fallback = options.fallback;
    }
    if ('clusterAdvanceProvider' in options) {
      this.clusterAdvanceProvider = options.clusterAdvanceProvider ?? null;
    }
  }

  resetAdapters(): void {
    this.primary = this.defaultPrimary;
    this.fallback = this.defaultFallback;
    this.clusterAdvanceProvider = this.defaultClusterAdvanceProvider;
  }

  getPrimaryAdapter(): TextMeasureAdapter {
    return this.primary;
  }

  getFallbackAdapter(): TextMeasureAdapter {
    return this.fallback;
  }

  getClusterAdvanceProvider(): TextMeasureClusterAdvanceProvider | null {
    return this.clusterAdvanceProvider;
  }

  private fallbackClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    if (this.fallback.measureClusterAdvancesWithSource != null) {
      return this.fallback.measureClusterAdvancesWithSource(request);
    }
    if (this.fallback.measureClusterAdvances != null) {
      return {
        advances: this.fallback.measureClusterAdvances(request),
        source: resolveAdapterAdvanceSource(this.fallback.kind),
      };
    }
    return {
      advances: new HeuristicMeasureAdapter().measureClusterAdvances(request),
      source: 'heuristic',
    };
  }

  fitTextToBox(input: TextMeasureInput, options: TextMeasureFitOptions): TextMeasureFitResult {
    const stepPt = Math.max(options.stepPt ?? 1, 0.25);
    let bestMeasurement: TextMeasureResult | null = null;

    for (let size = options.preferredFontSizePt; size >= options.minFontSizePt; size -= stepPt) {
      const candidateMeasurement = this.measure({
        ...input,
        style: {
          ...input.style,
          fontSizePt: Number(size.toFixed(3)),
        },
      });
      bestMeasurement = candidateMeasurement;
      if (candidateMeasurement.fitsWidth !== false && candidateMeasurement.fitsHeight !== false) {
        return {
          fontSizePt: Number(size.toFixed(3)),
          measurement: candidateMeasurement,
        };
      }
    }

    return {
      fontSizePt: options.minFontSizePt,
      measurement: bestMeasurement ?? this.measure({
        ...input,
        style: {
          ...input.style,
          fontSizePt: options.minFontSizePt,
        },
      }),
    };
  }
}

function resolveAdapterAdvanceSource(adapterKind: string): TextMeasureAdvanceSource {
  if (adapterKind === 'browser-pretext' || adapterKind === 'main-pretext-cached') {
    return 'pretext';
  }
  if (adapterKind === 'harfbuzz') {
    return 'harfbuzz';
  }
  return 'heuristic';
}
