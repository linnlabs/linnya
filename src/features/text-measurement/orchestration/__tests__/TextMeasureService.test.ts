import { describe, expect, it } from 'vitest';
import { TextMeasureService } from '../TextMeasureService.js';
import { HeuristicMeasureAdapter } from '../../adapters/HeuristicMeasureAdapter.js';
import type {
  NormalizedClusterAdvanceRequest,
  TextMeasureAdapter,
  TextMeasureClusterAdvanceProvider,
} from '../../definitions/types.js';

function createService(): TextMeasureService {
  return new TextMeasureService({
    primary: new HeuristicMeasureAdapter(),
  });
}

describe('TextMeasureService', () => {
  it('measures a single paragraph and marks heuristic fallback', () => {
    const service = createService();
    const result = service.measure({
      paragraphs: [{ text: 'Quarterly business review highlights' }],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 14,
        lineHeightMultiplier: 1.2,
      },
      box: {
        widthInches: 3.2,
        heightInches: 1.2,
        wrap: 'word',
      },
      sourceKind: 'generated',
    });

    expect(result.lineCount).toBeGreaterThanOrEqual(1);
    expect(result.totalHeightInches).toBeGreaterThan(0);
    expect(result.usedFallback).toBe(true);
  });

  it('preserves explicit hard breaks as separate measured lines', () => {
    const service = createService();
    const result = service.measure({
      paragraphs: [{ text: 'Line one\nLine two' }],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      box: {
        widthInches: 6,
        wrap: 'word',
      },
      sourceKind: 'generated',
    });

    expect(result.lineCount).toBe(2);
  });

  it('accounts for CJK and emoji content without collapsing to zero width', () => {
    const service = createService();
    const result = service.measure({
      paragraphs: [{ text: '增长引擎已启动 🚀 ready' }],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      box: {
        widthInches: 1.4,
        wrap: 'word',
      },
      sourceKind: 'ui-runtime',
    });

    expect(result.lineCount).toBeGreaterThan(1);
    expect(result.maxLineWidthInches).toBeGreaterThan(0);
  });

  it('includes padding, paragraph spacing, and indent in total height calculation', () => {
    const service = createService();
    const result = service.measure({
      paragraphs: [
        {
          text: 'Indented paragraph body copy that should wrap into multiple lines.',
          indentInches: 0.3,
          spacingBeforePt: 6,
          spacingAfterPt: 10,
        },
      ],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 11,
        lineHeightMultiplier: 1.3,
      },
      box: {
        widthInches: 2.2,
        heightInches: 1.18,
        wrap: 'word',
        padding: {
          top: 0.1,
          right: 0.08,
          bottom: 0.12,
          left: 0.08,
        },
      },
      sourceKind: 'imported',
    });

    expect(result.totalHeightInches).toBeGreaterThan(result.contentHeightInches);
    expect(result.fitsHeight).toBe(false);
  });

  it('fits text to box by shrinking font size through the shared service API', () => {
    const service = createService();
    const fitted = service.fitTextToBox({
      paragraphs: [{ text: 'A compact KPI label that must stay inside a narrow card.' }],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 14,
        lineHeightMultiplier: 1.1,
      },
      box: {
        widthInches: 1.45,
        heightInches: 0.4,
        wrap: 'word',
      },
      sourceKind: 'generated',
    }, {
      preferredFontSizePt: 14,
      minFontSizePt: 8,
      stepPt: 1,
    });

    expect(fitted.fontSizePt).toBeLessThan(14);
    expect(fitted.measurement.fitsHeight).toBe(true);
  });

  it('measures per-cluster advances through the shared service API', () => {
    const service = createService();
    const advances = service.measureClusterAdvances({
      clusters: ['a', 'b', 'c'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
        letterSpacingPt: 2,
      },
      sourceKind: 'generated',
    });

    expect(advances).toHaveLength(3);
    expect(advances[1]).toBeGreaterThan(advances[0]);
    expect(advances.every((advance) => advance > 0)).toBe(true);
  });

  it('reports the primary adapter source for per-cluster advances', () => {
    const fallback = new HeuristicMeasureAdapter();
    const service = new TextMeasureService({
      primary: {
        kind: 'browser-pretext',
        measure: fallback.measure.bind(fallback),
        measureClusterAdvances: (request) => request.clusters.map(() => 0.12),
      },
    });

    const result = service.measureClusterAdvancesWithSource({
      clusters: ['a', 'b'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });

    expect(result).toEqual({
      advances: [0.12, 0.12],
      source: 'pretext',
    });
  });

  it('reports heuristic when primary cluster advance measurement falls back', () => {
    const fallback = new HeuristicMeasureAdapter();
    const failingPrimary: TextMeasureAdapter = {
      kind: 'browser-pretext',
      measure: fallback.measure.bind(fallback),
      measureClusterAdvances: () => {
        throw new Error('pretext unavailable');
      },
    };
    const service = new TextMeasureService({
      primary: failingPrimary,
      fallback,
    });

    const result = service.measureClusterAdvancesWithSource({
      clusters: ['a', 'b'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });

    expect(result.source).toBe('heuristic');
    expect(result.advances).toHaveLength(2);
  });

  it('uses an independent cluster advance provider without changing primary measure', () => {
    const primary = new HeuristicMeasureAdapter();
    const service = new TextMeasureService({
      primary,
      clusterAdvanceProvider: new FixedClusterAdvanceProvider('harfbuzz', [0.2, 0.3]),
    });

    const measured = service.measure({
      paragraphs: [{ text: 'body text' }],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      box: {
        widthInches: 2,
      },
      sourceKind: 'generated',
    });
    const advances = service.measureClusterAdvancesWithSource({
      clusters: ['a', 'b'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });

    expect(measured.usedFallback).toBe(true);
    expect(advances).toEqual({
      advances: [0.2, 0.3],
      source: 'harfbuzz',
    });
  });

  it('falls back to primary cluster advances when the independent provider cannot serve the request', () => {
    const fallback = new HeuristicMeasureAdapter();
    const service = new TextMeasureService({
      primary: {
        kind: 'browser-pretext',
        measure: fallback.measure.bind(fallback),
        measureClusterAdvancesWithSource: (request) => ({
          advances: request.clusters.map(() => 0.11),
          source: 'pretext',
        }),
      },
      fallback,
      clusterAdvanceProvider: new FixedClusterAdvanceProvider('heuristic', [0.2, 0.3]),
    });

    const result = service.measureClusterAdvancesWithSource({
      clusters: ['a', 'b'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });

    expect(result).toEqual({
      advances: [0.11, 0.11],
      source: 'pretext',
    });
  });
});

class FixedClusterAdvanceProvider implements TextMeasureClusterAdvanceProvider {
  readonly kind = 'fixed-cluster';

  constructor(
    private readonly source: 'pretext' | 'heuristic' | 'harfbuzz',
    private readonly advances: readonly number[],
  ) {}

  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(
    _request: NormalizedClusterAdvanceRequest,
  ): { advances: number[]; source: 'pretext' | 'heuristic' | 'harfbuzz' } {
    return {
      advances: [...this.advances],
      source: this.source,
    };
  }
}
