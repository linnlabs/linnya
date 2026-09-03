import { describe, expect, it, vi } from 'vitest';

import { Logger } from '@shared/logger';
import { reconcileCollectionSegmentTarget } from './segmentCoordinator';

describe('segmentCoordinator', () => {
  it('当目标段数未变化时不应 PATCH collection', async () => {
    const updateCollection = vi.fn(async () => undefined);
    const result = await reconcileCollectionSegmentTarget({
      collectionName: 'kb-small',
      logger: new Logger('segment-coordinator-test'),
      getCollectionInfo: async () => ({
        points_count: 300,
        segments_count: 6,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      updateCollection,
    });

    expect(result.updated).toBe(false);
    expect(result.previousTargetSegmentCount).toBe(1);
    expect(result.nextTargetSegmentCount).toBe(1);
    expect(updateCollection).not.toHaveBeenCalled();
  });

  it('当目标段数变化时应 PATCH collection', async () => {
    const updateCollection = vi.fn(async () => undefined);
    const result = await reconcileCollectionSegmentTarget({
      collectionName: 'kb-medium',
      logger: new Logger('segment-coordinator-test'),
      getCollectionInfo: async () => ({
        points_count: 25_000,
        segments_count: 6,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      updateCollection,
    });

    expect(result.updated).toBe(true);
    expect(result.previousTargetSegmentCount).toBe(1);
    expect(result.nextTargetSegmentCount).toBe(2);
    expect(updateCollection).toHaveBeenCalledWith({
      optimizers_config: {
        default_segment_number: 2,
      },
    });
  });

  it('超过阈值时应回退到自动策略', async () => {
    const updateCollection = vi.fn(async () => undefined);
    const result = await reconcileCollectionSegmentTarget({
      collectionName: 'kb-large',
      logger: new Logger('segment-coordinator-test'),
      getCollectionInfo: async () => ({
        points_count: 600_000,
        segments_count: 8,
        config: {
          optimizer_config: {
            default_segment_number: 4,
          },
        },
      }),
      updateCollection,
    });

    expect(result.updated).toBe(true);
    expect(result.previousTargetSegmentCount).toBe(4);
    expect(result.nextTargetSegmentCount).toBe(0);
    expect(updateCollection).toHaveBeenCalledWith({
      optimizers_config: {
        default_segment_number: 0,
      },
    });
  });
});

