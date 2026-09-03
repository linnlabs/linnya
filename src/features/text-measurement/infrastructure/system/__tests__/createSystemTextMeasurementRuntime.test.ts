import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultTextMeasureService,
  resetDefaultTextMeasureServiceForTests,
  type TextMeasureClusterAdvanceProvider,
} from '../../../index.js';
import { createSystemTextMeasurementRuntimeWithProviderFactory } from '../createSystemTextMeasurementRuntime.js';

afterEach(() => {
  resetDefaultTextMeasureServiceForTests();
});

describe('SystemTextMeasurementRuntime', () => {
  it('为 standalone 排版安装 cluster advance provider，并在 dispose 后恢复默认值', async () => {
    const provider: TextMeasureClusterAdvanceProvider = {
      kind: 'audit-harfbuzz',
      measureClusterAdvances: (request) => request.clusters.map(() => 0.125),
      measureClusterAdvancesWithSource: (request) => ({
        advances: request.clusters.map(() => 0.125),
        source: 'harfbuzz',
      }),
    };
    const runtime = createSystemTextMeasurementRuntimeWithProviderFactory(
      async () => provider,
    );
    const request = {
      clusters: ['A', 'B'],
      style: { fontFamily: 'Audit Sans', fontSizePt: 10 },
      sourceKind: 'generated' as const,
    };

    await runtime.initialize();

    expect(defaultTextMeasureService.measureClusterAdvancesWithSource(request)).toEqual({
      advances: [0.125, 0.125],
      source: 'harfbuzz',
    });

    runtime.dispose();

    expect(defaultTextMeasureService.measureClusterAdvancesWithSource(request).source)
      .toBe('heuristic');
  });
});
