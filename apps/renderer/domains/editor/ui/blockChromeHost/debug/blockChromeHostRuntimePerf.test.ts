// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { recordBlockChromeHostShadowSnapshot } from './blockChromeHostRuntimePerf';

describe('blockChromeHostRuntimePerf', () => {
  it('records active blocks, source counts and missing targets', () => {
    window.__BLOCK_CHROME_HOST_PERF__?.clear();

    recordBlockChromeHostShadowSnapshot({
      activeBlocks: [
        { blockId: 'block-a', sources: ['focused'] },
        { blockId: 'block-b', sources: ['selected', 'keep-alive'] },
      ],
      targetReadyBlockIds: new Set(['block-a']),
      renderPlans: [
        {
          blockId: 'block-a',
          sources: ['focused'],
          surfaces: ['left-handle', 'annotation-handle'],
          targetReady: true,
        },
        {
          blockId: 'block-b',
          sources: ['selected', 'keep-alive'],
          surfaces: ['left-handle'],
          targetReady: false,
        },
      ],
    });

    expect(window.__BLOCK_CHROME_HOST_PERF__?.getSnapshot()).toMatchObject({
      activeCount: 2,
      targetReadyCount: 1,
      bySource: {
        focused: 1,
        selected: 1,
        'keep-alive': 1,
      },
      bySurface: {
        'left-handle': 2,
        'annotation-handle': 1,
      },
      blockIds: ['block-a', 'block-b'],
      missingTargetBlockIds: ['block-b'],
      plans: [
        {
          blockId: 'block-a',
          sources: ['focused'],
          surfaces: ['left-handle', 'annotation-handle'],
          targetReady: true,
        },
        {
          blockId: 'block-b',
          sources: ['selected', 'keep-alive'],
          surfaces: ['left-handle'],
          targetReady: false,
        },
      ],
    });
  });
});
