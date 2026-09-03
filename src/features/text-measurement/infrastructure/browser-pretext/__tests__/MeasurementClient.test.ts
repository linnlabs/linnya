import { describe, expect, it, vi } from 'vitest';
import type {
  NormalizedTextMeasureInput,
  TextMeasureAdapter,
  TextMeasureResult,
} from '../../../index.js';
import {
  normalizeClusterAdvanceRequest,
  normalizeTextMeasureInput,
} from '../../../index.js';
import { MeasurementCache } from '../MeasurementCache.js';
import { MeasurementClient } from '../MeasurementClient.js';

interface MeasurementWorkerPortStub {
  measureBatch: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
}

function createInput(text: string): NormalizedTextMeasureInput {
  return normalizeTextMeasureInput({
    paragraphs: [{ text }],
    style: {
      fontFamily: 'Arial',
      fontSizePt: 12,
      lineHeightMultiplier: 1.2,
    },
    box: {
      widthInches: 2.4,
      heightInches: 0.8,
      wrap: 'word',
    },
    sourceKind: 'generated',
  });
}

function createResult(overrides: Partial<TextMeasureResult> = {}): TextMeasureResult {
  return {
    lineCount: 1,
    contentHeightInches: 0.2,
    totalHeightInches: 0.2,
    maxLineWidthInches: 1.5,
    usedFallback: false,
    warnings: [],
    fitsWidth: true,
    fitsHeight: true,
    ...overrides,
  };
}

function createFallbackAdapter(): TextMeasureAdapter {
  return {
    kind: 'fallback-test',
    measure(input) {
      return createResult({
        lineCount: input.paragraphs.length,
        usedFallback: true,
        warnings: ['fallback-result'],
      });
    },
    measureClusterAdvances(request) {
      return request.clusters.map(() => 0.2);
    },
  };
}

describe('MeasurementClient', () => {
  it('prewarms cache misses and serves subsequent sync reads from cache', async () => {
    const input = createInput('Quarterly growth');
    const worker: MeasurementWorkerPortStub = {
      measureBatch: vi.fn(async () => ({
        requestId: 'req-1',
        protocolVersion: 1,
        results: [createResult({ maxLineWidthInches: 1.1 })],
      })),
      touch: vi.fn(),
    };
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: worker,
    });

    await client.prewarm([input]);
    const measured = client.measure(input);

    expect(worker.measureBatch).toHaveBeenCalledTimes(1);
    expect(worker.touch).toHaveBeenCalledTimes(1);
    expect(measured.maxLineWidthInches).toBe(1.1);
    expect(measured.usedFallback).toBe(false);
  });

  it('falls back synchronously on cache miss and appends a cache-miss warning', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const onFallback = vi.fn();
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: {
        measureBatch: vi.fn(),
        touch: vi.fn(),
      },
      logger,
      cacheMissWarnSampleRate: 1,
      onFallback,
    });

    const input = createInput('Cache miss');
    const measured = client.measure(input);

    expect(measured.usedFallback).toBe(true);
    expect(measured.warnings).toContain('fallback-result');
    expect(
      measured.warnings.some((warning) => warning.includes('cache miss')),
    ).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('measurement.cache miss_fallback'));
    expect(onFallback).toHaveBeenCalledWith({
      sourceKind: 'generated',
      textLength: 'Cache miss'.length,
      fontFamily: 'Arial',
      fontSizePt: 12,
      bold: false,
      italic: false,
      wrap: 'word',
      widthInches: input.box.widthInches,
      cacheHits: 0,
      cacheMisses: 1,
      hitRate: 0,
    });
  });

  it('swallows prewarm failures and keeps sync fallback available', async () => {
    const input = createInput('Worker unavailable');
    const worker: MeasurementWorkerPortStub = {
      measureBatch: vi.fn(async () => {
        throw new Error('spawn failed');
      }),
      touch: vi.fn(),
    };
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: worker,
    });

    await expect(client.prewarm([input])).resolves.toBeUndefined();

    const measured = client.measure(input);
    expect(measured.usedFallback).toBe(true);
    expect(worker.touch).not.toHaveBeenCalled();
  });

  it('does not cache worker-side item errors', async () => {
    const input = createInput('Bad item');
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: {
        measureBatch: vi.fn(async () => ({
          requestId: 'req-2',
          protocolVersion: 1 as const,
          results: [{ error: 'pretext failed' }],
        })),
        touch: vi.fn(),
      },
    });

    await client.prewarm([input]);
    const measured = client.measure(input);

    expect(measured.usedFallback).toBe(true);
    expect(
      measured.warnings.some((warning) => warning.includes('cache miss')),
    ).toBe(true);
  });

  it('prewarms cluster advance cache and serves sync layout reads from cache', async () => {
    const request = normalizeClusterAdvanceRequest({
      clusters: ['a', 'b', 'c'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });
    const worker = {
      measureBatch: vi.fn(),
      measureClusterAdvancesBatch: vi.fn(async () => ({
        requestId: 'cluster-req-1',
        protocolVersion: 1 as const,
        results: [],
        clusterResults: [{ advances: [0.1, 0.11, 0.12] }],
      })),
      touch: vi.fn(),
    };
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: worker,
    });

    await client.prewarmClusterAdvances([request]);
    const result = client.measureClusterAdvancesWithSource(request);

    expect(worker.measureClusterAdvancesBatch).toHaveBeenCalledTimes(1);
    expect(worker.touch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      advances: [0.1, 0.11, 0.12],
      source: 'pretext',
    });
  });

  it('reports heuristic source for sync cluster advance cache misses', () => {
    const request = normalizeClusterAdvanceRequest({
      clusters: ['a', 'b'],
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
      },
      sourceKind: 'generated',
    });
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: {
        measureBatch: vi.fn(),
        measureClusterAdvancesBatch: vi.fn(),
        touch: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    const result = client.measureClusterAdvancesWithSource(request);

    expect(result).toEqual({
      advances: [0.2, 0.2],
      source: 'heuristic',
    });
  });

  it('evicts least-recently used cluster advance entries when the cache reaches its cap', async () => {
    const requestA = normalizeClusterAdvanceRequest({
      clusters: ['a'],
      style: { fontFamily: 'Arial', fontSizePt: 12 },
      sourceKind: 'generated',
    });
    const requestB = normalizeClusterAdvanceRequest({
      clusters: ['b'],
      style: { fontFamily: 'Arial', fontSizePt: 12 },
      sourceKind: 'generated',
    });
    const requestC = normalizeClusterAdvanceRequest({
      clusters: ['c'],
      style: { fontFamily: 'Arial', fontSizePt: 12 },
      sourceKind: 'generated',
    });
    const worker = {
      measureBatch: vi.fn(),
      measureClusterAdvancesBatch: vi.fn(async () => ({
        requestId: 'cluster-req-2',
        protocolVersion: 1 as const,
        results: [],
        clusterResults: [
          { advances: [0.1] },
          { advances: [0.2] },
          { advances: [0.3] },
        ],
      })),
      touch: vi.fn(),
    };
    const client = new MeasurementClient({
      cache: new MeasurementCache(),
      fallback: createFallbackAdapter(),
      workerManager: worker,
      clusterAdvanceCacheMaxSize: 2,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    await client.prewarmClusterAdvances([requestA, requestB, requestC]);

    expect(client.measureClusterAdvancesWithSource(requestA).source).toBe('heuristic');
    expect(client.measureClusterAdvancesWithSource(requestB).source).toBe('pretext');
    expect(client.measureClusterAdvancesWithSource(requestC).source).toBe('pretext');
  });
});
