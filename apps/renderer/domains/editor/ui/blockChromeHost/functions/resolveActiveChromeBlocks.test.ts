import { describe, expect, it } from 'vitest';
import { resolveActiveChromeBlocks } from './resolveActiveChromeBlocks';

describe('resolveActiveChromeBlocks', () => {
  it('按来源优先级稳定合并 active chrome block', () => {
    expect(resolveActiveChromeBlocks({
      focusedBlockId: 'block-focused',
      hoveredBlockId: 'block-hovered',
      annotationActiveBlockIds: ['block-annotation'],
      selectedBlockId: 'block-selected',
    })).toEqual([
      { blockId: 'block-hovered', sources: ['hovered'] },
      { blockId: 'block-selected', sources: ['selected'] },
      { blockId: 'block-focused', sources: ['focused'] },
      { blockId: 'block-annotation', sources: ['annotation'] },
    ]);
  });

  it('同一个 block 只输出一次，并保留全部来源', () => {
    expect(resolveActiveChromeBlocks({
      hoveredBlockId: 'block-a',
      selectedBlockId: 'block-a',
      annotationActiveBlockIds: ['block-a', 'block-a'],
      keepAlivePinnedBlockIds: ['block-a'],
    })).toEqual([
      {
        blockId: 'block-a',
        sources: ['hovered', 'selected', 'annotation', 'keep-alive'],
      },
    ]);
  });

  it('忽略空 blockId 并保留列表内部顺序', () => {
    expect(resolveActiveChromeBlocks({
      hoveredBlockId: '   ',
      annotationActiveBlockIds: [null, 'block-b', undefined, 'block-c'],
      revisionToolbarBlockIds: ['block-d'],
    })).toEqual([
      { blockId: 'block-b', sources: ['annotation'] },
      { blockId: 'block-c', sources: ['annotation'] },
      { blockId: 'block-d', sources: ['revision-toolbar'] },
    ]);
  });
});
