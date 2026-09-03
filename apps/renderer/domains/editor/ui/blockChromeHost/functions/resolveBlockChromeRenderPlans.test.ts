import { describe, expect, it } from 'vitest';
import { resolveBlockChromeRenderPlans } from './resolveBlockChromeRenderPlans';

describe('resolveBlockChromeRenderPlans', () => {
  it('为普通 active block 生成基础 chrome surface', () => {
    expect(resolveBlockChromeRenderPlans({
      activeBlocks: [
        { blockId: 'root-a', sources: ['hovered'] },
      ],
      targetReadyBlockIds: new Set(['root-a']),
    })).toEqual([
      {
        blockId: 'root-a',
        sources: ['hovered'],
        surfaces: ['left-handle', 'annotation-handle'],
        targetReady: true,
      },
    ]);
  });

  it('只为明确来源追加 revision toolbar 与 history panel', () => {
    expect(resolveBlockChromeRenderPlans({
      activeBlocks: [
        { blockId: 'root-revision', sources: ['focused', 'revision-toolbar'] },
        { blockId: 'root-history', sources: ['history-mode', 'keep-alive'] },
      ],
      targetReadyBlockIds: new Set(['root-history']),
    })).toEqual([
      {
        blockId: 'root-revision',
        sources: ['focused', 'revision-toolbar'],
        surfaces: ['left-handle', 'annotation-handle', 'revision-toolbar'],
        targetReady: false,
      },
      {
        blockId: 'root-history',
        sources: ['history-mode', 'keep-alive'],
        surfaces: ['left-handle', 'annotation-handle', 'history-panel'],
        targetReady: true,
      },
    ]);
  });
});
