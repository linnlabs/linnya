import { describe, expect, it } from 'vitest';
import {
  buildPresentationSourceRevision,
  reconstructPresentationSource,
} from './presentationSourceRevisionCodec';

describe('presentation source revision codec', () => {
  it('用首个 checkpoint 和后续 patch 精确重建源码', () => {
    const firstSource = 'const slide = createSlide();\ncompose({ title: "A", slides: [slide] });\n';
    const secondSource = firstSource.replace('title: "A"', 'title: "B"');
    const first = buildPresentationSourceRevision({
      revision: 1,
      source: firstSource,
      parentSource: null,
      accumulatedPatchBytes: 0,
    });
    const second = buildPresentationSourceRevision({
      revision: 2,
      source: secondSource,
      parentSource: firstSource,
      accumulatedPatchBytes: 0,
    });

    expect(first.storageKind).toBe('checkpoint');
    expect(second.storageKind).toBe('patch');
    expect(reconstructPresentationSource([
      { revisionId: 'rev-1', revision: 1, ...first },
      { revisionId: 'rev-2', revision: 2, ...second },
    ])).toBe(secondSource);
  });

  it('第 25 个 revision 强制写 checkpoint', () => {
    const source = 'const slide = createSlide();\ncompose({ title: "A", slides: [slide] });';
    const result = buildPresentationSourceRevision({
      revision: 25,
      source: source.replace('"A"', '"B"'),
      parentSource: source,
      accumulatedPatchBytes: 0,
    });

    expect(result.storageKind).toBe('checkpoint');
    expect(result.patchBytes).toBe(0);
  });

  it('累计 patch 达到完整源码大小时写 checkpoint', () => {
    const source = `${'const value = 1;\n'.repeat(30)}compose({ title: "A", slides: [] });`;
    const result = buildPresentationSourceRevision({
      revision: 8,
      source: source.replace('title: "A"', 'title: "B"'),
      parentSource: source,
      accumulatedPatchBytes: Buffer.byteLength(source, 'utf8'),
    });

    expect(result.storageKind).toBe('checkpoint');
  });

  it('拒绝 hash 被篡改的重建链', () => {
    const source = 'compose({ title: "A", slides: [] });';
    const checkpoint = buildPresentationSourceRevision({
      revision: 1,
      source,
      parentSource: null,
      accumulatedPatchBytes: 0,
    });

    expect(() => reconstructPresentationSource([{
      revisionId: 'rev-1',
      revision: 1,
      ...checkpoint,
      sourceHash: 'tampered',
    }])).toThrow('source hash 不一致');
  });
});
