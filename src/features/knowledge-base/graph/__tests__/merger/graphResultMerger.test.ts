import { describe, it, expect } from 'vitest';
import { GraphResultMerger, type MergeInputWithKeys } from '../../application/merger/graphResultMerger';
import type { GraphAugmentation } from '../../application/graphSearchService';

describe('GraphResultMerger', () => {
  const merger = new GraphResultMerger();

  // Mock GraphAugmentation
  const mockAugmentation: GraphAugmentation = {
    entities: [],
    relations: [],
  };

  it('应该保留所有 Chunk-Driven 结果', () => {
    const chunkDrivenResults = new Map<string, GraphAugmentation>();
    chunkDrivenResults.set('key1', mockAugmentation);
    chunkDrivenResults.set('key2', mockAugmentation);

    const input: MergeInputWithKeys = {
      chunkDrivenResults,
      discoveryResults: [],
    };

    const output = merger.mergeWithKeys(input);
    expect(output.mergedResults.size).toBe(2);
    expect(output.mergedResults.has('key1')).toBe(true);
    expect(output.mergedResults.has('key2')).toBe(true);
    expect(output.stats.chunkDrivenCount).toBe(2);
  });

  it('应该添加未重复的 Discovery 结果', () => {
    const chunkDrivenResults = new Map<string, GraphAugmentation>();
    chunkDrivenResults.set('key1', mockAugmentation);

    const discoveryResults = [
      {
        key: 'key2', // New key
        docId: 'doc2',
        blockId: 'block2',
        score: 0.9,
        augmentation: mockAugmentation,
      },
    ];

    const input: MergeInputWithKeys = {
      chunkDrivenResults,
      discoveryResults,
    };

    const output = merger.mergeWithKeys(input);
    expect(output.mergedResults.size).toBe(2); // key1 + key2
    expect(output.mergedResults.has('key2')).toBe(true);
    expect(output.stats.discoveryAddedCount).toBe(1);
  });

  it('应该过滤掉与 Chunk-Driven 重复的 Discovery 结果', () => {
    const chunkDrivenResults = new Map<string, GraphAugmentation>();
    chunkDrivenResults.set('key1', mockAugmentation);

    const discoveryResults = [
      {
        key: 'key1', // Duplicate key
        docId: 'doc1',
        blockId: 'block1',
        score: 0.9,
        augmentation: mockAugmentation,
      },
      {
        key: 'key2', // New key
        docId: 'doc2',
        blockId: 'block2',
        score: 0.9,
        augmentation: mockAugmentation,
      },
    ];

    const input: MergeInputWithKeys = {
      chunkDrivenResults,
      discoveryResults,
    };

    const output = merger.mergeWithKeys(input);
    expect(output.mergedResults.size).toBe(2); // key1 + key2 (key1 was deduped)
    expect(output.stats.discoveryFilteredByDuplication).toBe(1);
    expect(output.stats.discoveryAddedCount).toBe(1);
  });

  it('应该过滤掉分数低于阈值的 Discovery 结果', () => {
    const chunkDrivenResults = new Map<string, GraphAugmentation>();

    const discoveryResults = [
      {
        key: 'key1',
        docId: 'doc1',
        blockId: 'block1',
        score: 0.5, // Low score
        augmentation: mockAugmentation,
      },
      {
        key: 'key2',
        docId: 'doc2',
        blockId: 'block2',
        score: 0.9, // High score
        augmentation: mockAugmentation,
      },
    ];

    const input: MergeInputWithKeys = {
      chunkDrivenResults,
      discoveryResults,
      minScoreThreshold: 0.8,
    };

    const output = merger.mergeWithKeys(input);
    expect(output.mergedResults.size).toBe(1); // Only key2
    expect(output.stats.discoveryFilteredByScore).toBe(1);
    expect(output.stats.discoveryAddedCount).toBe(1);
  });
});
