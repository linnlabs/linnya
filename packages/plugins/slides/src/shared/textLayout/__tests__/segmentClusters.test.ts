import { describe, expect, it } from 'vitest';
import { segmentClusters } from '../index';

describe('segmentClusters', () => {
  it('segments latin graphemes and marks whitespace as a break opportunity', () => {
    const clusters = segmentClusters('ab cd');

    expect(clusters.map((cluster) => cluster.text)).toEqual(['a', 'b', ' ', 'c', 'd']);
    expect(clusters[2]?.breakAfter).toBe(true);
    expect(clusters[0]?.breakAfter).toBe(false);
  });

  it('allows breaks after CJK clusters', () => {
    const clusters = segmentClusters('中文ab');

    expect(clusters[0]?.breakAfter).toBe(true);
    expect(clusters[1]?.breakAfter).toBe(true);
    expect(clusters[2]?.breakAfter).toBe(false);
  });

  it('keeps emoji ZWJ sequences as one cluster', () => {
    expect(segmentClusters('👨‍👩‍👧')).toHaveLength(1);
  });

  it('allows breaks after hyphen', () => {
    const clusters = segmentClusters('re-do');

    expect(clusters[2]?.text).toBe('-');
    expect(clusters[2]?.breakAfter).toBe(true);
  });
});
