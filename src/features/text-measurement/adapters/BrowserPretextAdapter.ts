import {
  measureLineStats,
  prepareWithSegments,
  type PreparedTextWithSegments,
  type PrepareOptions,
} from '@chenglou/pretext';
import { buildCanvasFontShorthand } from '../functions/FontResolver.js';
import type {
  ClusterAdvanceMeasureResult,
  NormalizedTextMeasureInput,
  NormalizedClusterAdvanceRequest,
  TextMeasureAdapter,
  TextMeasureResult,
} from '../definitions/types.js';
import { inchesToPixels, pixelsToInches, pointsToInches, pointsToPixels } from '../functions/UnitConverter.js';

/** 缓存上限，防止长会话内存无限增长 */
const PREPARED_CACHE_MAX_SIZE = 512;

function resolvePrepareOptions(wrap: NormalizedTextMeasureInput['box']['wrap']): PrepareOptions {
  if (wrap === 'char') {
    // char-wrap 的真实断行由消费方布局引擎处理；Pretext 只接 word/none 测量入口。
    throw new Error('BrowserPretextAdapter does not support Konva char-wrap mode directly.');
  }
  return { whiteSpace: 'pre-wrap' };
}

function canUseBrowserMeasurement(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
}

function createCanvasContext(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (context == null) {
      throw new Error('BrowserPretextAdapter failed to create canvas context.');
    }
    return context;
  }

  const context = document.createElement('canvas').getContext('2d');
  if (context == null) {
    throw new Error('BrowserPretextAdapter failed to create canvas context.');
  }
  return context;
}

export class BrowserPretextAdapter implements TextMeasureAdapter {
  readonly kind = 'browser-pretext';

  private readonly preparedCache = new Map<string, PreparedTextWithSegments>();

  measure(input: NormalizedTextMeasureInput): TextMeasureResult {
    if (!canUseBrowserMeasurement()) {
      throw new Error('BrowserPretextAdapter requires OffscreenCanvas or DOM canvas.');
    }

    const noWrap = input.box.wrap === 'none';
    let lineCount = 0;
    let contentHeightInches = 0;
    let maxLineWidthInches = 0;

    for (const paragraph of input.paragraphs) {
      const prepareOptions = resolvePrepareOptions(input.box.wrap);
      const font = buildCanvasFontShorthand(input.style);
      const prepared = this.prepareParagraph(paragraph.text, font, prepareOptions);
      // wrap:'none' 时用极大宽度阻止 Pretext 断行
      const maxWidthPx = noWrap
        ? Number.MAX_SAFE_INTEGER
        : inchesToPixels(
          Math.max(0.05, input.box.usableWidthInches - Math.max(paragraph.indentInches ?? 0, 0)),
        );
      const lineHeightPx = pointsToPixels(input.style.fontSizePt) * input.style.lineHeightMultiplier;
      const stats = measureLineStats(prepared, maxWidthPx);
      lineCount += stats.lineCount;
      maxLineWidthInches = Math.max(
        maxLineWidthInches,
        pixelsToInches(stats.maxLineWidth) + Math.max(paragraph.indentInches ?? 0, 0),
      );
      contentHeightInches += pointsToInches(paragraph.spacingBeforePt ?? 0);
      contentHeightInches += pointsToInches(paragraph.spacingAfterPt ?? 0);
      contentHeightInches += pixelsToInches(stats.lineCount * lineHeightPx);
    }

    const totalHeightInches = contentHeightInches + input.box.padding.top + input.box.padding.bottom;
    const tolerance = 0.01;
    const fitsWidth = maxLineWidthInches <= input.box.usableWidthInches + tolerance;
    const fitsHeight = input.box.usableHeightInches == null
      ? undefined
      : totalHeightInches <= input.box.usableHeightInches + input.box.padding.top + input.box.padding.bottom + tolerance;

    return {
      lineCount,
      contentHeightInches: Number(contentHeightInches.toFixed(3)),
      totalHeightInches: Number(totalHeightInches.toFixed(3)),
      maxLineWidthInches: Number(maxLineWidthInches.toFixed(3)),
      usedFallback: false,
      warnings: [],
      fitsWidth,
      fitsHeight,
    };
  }

  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    if (!canUseBrowserMeasurement()) {
      throw new Error('BrowserPretextAdapter requires OffscreenCanvas or DOM canvas.');
    }

    const context = createCanvasContext();
    context.font = buildCanvasFontShorthand(request.style);

    const letterSpacingInches = pointsToInches(request.style.letterSpacingPt ?? 0);
    let prefix = '';
    let previousWidthPx = 0;

    const advances = request.clusters.map((cluster, index) => {
      prefix += cluster;
      const nextWidthPx = context.measureText(prefix).width;
      const advance = pixelsToInches(nextWidthPx - previousWidthPx)
        + (index > 0 ? letterSpacingInches : 0);
      previousWidthPx = nextWidthPx;
      return Number(advance.toFixed(6));
    });

    return {
      advances,
      source: 'pretext',
    };
  }

  clearCache(): void {
    this.preparedCache.clear();
  }

  private prepareParagraph(text: string, font: string, options: PrepareOptions): PreparedTextWithSegments {
    const cacheKey = `${font}::${options.whiteSpace ?? 'normal'}::${options.wordBreak ?? 'normal'}::${text}`;
    const cached = this.preparedCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    // LRU 简易淘汰：超过上限时批量清除最旧的 1/4 条目
    if (this.preparedCache.size >= PREPARED_CACHE_MAX_SIZE) {
      const keysToDelete = Math.floor(PREPARED_CACHE_MAX_SIZE / 4);
      const iter = this.preparedCache.keys();
      for (let i = 0; i < keysToDelete; i++) {
        const next = iter.next();
        if (next.done) break;
        this.preparedCache.delete(next.value);
      }
    }
    const prepared = prepareWithSegments(text, font, options);
    this.preparedCache.set(cacheKey, prepared);
    return prepared;
  }
}
