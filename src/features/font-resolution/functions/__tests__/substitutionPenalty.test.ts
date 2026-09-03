import { describe, expect, it } from 'vitest';
import type { FontMetadata, FontRequest } from '../../definitions/types.js';
import { scoreSubstitution } from '../substitutionPenalty.js';

const SANS_PANOSE = [2, 11, 5, 3, 2, 2, 4, 2, 2, 4] as const;
const SERIF_PANOSE = [2, 2, 6, 3, 5, 4, 5, 2, 3, 4] as const;
const MONO_PANOSE = [2, 11, 6, 9, 3, 8, 4, 2, 2, 4] as const;

describe('scoreSubstitution', () => {
  it('同为无衬线且平均宽度接近的候选，penalty 低于衬线候选', () => {
    const request = makeRequest({ family: 'Calibri', script: 'latin' });
    const sansLike = makeMeta({
      family: 'Aptos',
      panose: SANS_PANOSE,
      avgCharWidth: 0.5,
    });
    const serifLike = makeMeta({
      family: 'Times New Roman',
      panose: SERIF_PANOSE,
      avgCharWidth: 0.5,
    });

    expect(scoreSubstitution(request, sansLike)).toBeLessThan(scoreSubstitution(request, serifLike));
  });

  it('eastAsian 请求下，无 CJK unicode range 覆盖的候选被重罚', () => {
    const request = makeRequest({ family: '微软雅黑', script: 'eastAsian' });
    const cjkCandidate = makeMeta({
      family: 'PingFang SC',
      unicodeRanges: rangesWithBits([59]),
      avgCharWidth: 0.96,
    });
    const latinOnlyCandidate = makeMeta({
      family: 'Arial',
      unicodeRanges: rangesWithBits([0, 1]),
      avgCharWidth: 0.5,
    });

    expect(scoreSubstitution(request, cjkCandidate)).toBeLessThan(scoreSubstitution(request, latinOnlyCandidate));
  });

  it('等宽请求匹配非等宽候选被重罚', () => {
    const request = makeRequest({ family: 'Consolas', script: 'latin' });
    const monoCandidate = makeMeta({
      family: 'Menlo',
      panose: MONO_PANOSE,
      isFixedPitch: true,
      avgCharWidth: 0.6,
    });
    const proportionalCandidate = makeMeta({
      family: 'Arial',
      panose: SANS_PANOSE,
      isFixedPitch: false,
      avgCharWidth: 0.5,
    });

    expect(scoreSubstitution(request, monoCandidate)).toBeLessThan(scoreSubstitution(request, proportionalCandidate));
  });

  it('平均字符宽度偏差 20% 的候选，penalty 高于偏差 2% 的候选', () => {
    const request = makeRequest({ family: 'Requested Sans', script: 'latin' });
    const requestedMeta = makeMeta({
      family: 'Requested Sans',
      avgCharWidth: 0.5,
    });
    const closeWidth = makeMeta({
      family: 'Close Sans',
      avgCharWidth: 0.51,
    });
    const farWidth = makeMeta({
      family: 'Wide Sans',
      avgCharWidth: 0.6,
    });

    expect(scoreSubstitution(request, closeWidth, requestedMeta)).toBeLessThan(
      scoreSubstitution(request, farWidth, requestedMeta),
    );
  });

  it('family name 精确匹配且样式一致时 penalty 为 0', () => {
    const request = makeRequest({ family: 'Arial', script: 'latin' });
    const exactCandidate = makeMeta({
      family: 'arial',
      postscriptName: 'ArialMT',
    });

    expect(scoreSubstitution(request, exactCandidate)).toBe(0);
  });

  it('缺失 PANOSE 与非正 xAvgCharWidth 不能被当作零差异而胜出', () => {
    const request = makeRequest({ family: 'Calibri', script: 'latin' });
    const completeCandidate = makeMeta({
      family: 'Complete Sans',
      panose: SANS_PANOSE,
      avgCharWidth: 0.52,
    });
    const unknownCandidate = makeMeta({
      family: 'Unknown Sans',
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      avgCharWidth: -0.5,
    });

    expect(scoreSubstitution(request, completeCandidate)).toBeLessThan(
      scoreSubstitution(request, unknownCandidate),
    );
  });

  it('请求 bold 时优先真实 bold face，不被 regular 的轻微宽度优势覆盖', () => {
    const request = makeRequest({ family: 'Calibri', bold: true });
    const regular = makeMeta({
      family: 'Candidate Sans',
      postscriptName: 'CandidateSans-Regular',
      avgCharWidth: 0.5,
      bold: false,
    });
    const bold = makeMeta({
      family: 'Candidate Sans',
      postscriptName: 'CandidateSans-Bold',
      avgCharWidth: 0.53,
      bold: true,
    });

    expect(scoreSubstitution(request, bold)).toBeLessThan(scoreSubstitution(request, regular));
  });
});

function makeRequest(overrides: Partial<FontRequest> = {}): FontRequest {
  return {
    family: 'Arial',
    bold: false,
    italic: false,
    script: 'latin',
    ...overrides,
  };
}

function makeMeta(overrides: Partial<FontMetadata> = {}): FontMetadata {
  return {
    family: 'Arial',
    subfamily: 'Regular',
    postscriptName: 'Arial',
    filePath: '/fonts/arial.ttf',
    faceIndex: 0,
    panose: SANS_PANOSE,
    unicodeRanges: rangesWithBits([0, 1]),
    glyphCodePointRanges: [[0, 0x10FFFF]],
    isFixedPitch: false,
    avgCharWidth: 0.5,
    winAscent: 0.9,
    winDescent: 0.2,
    typoAscent: 0.75,
    typoDescent: -0.25,
    typoLineGap: 0.2,
    useTypoMetrics: false,
    bold: false,
    italic: false,
    ...overrides,
  };
}

function rangesWithBits(bits: readonly number[]): readonly [number, number, number, number] {
  const ranges = [0, 0, 0, 0];
  for (const bit of bits) {
    const rangeIndex = Math.floor(bit / 32);
    const bitOffset = bit % 32;
    ranges[rangeIndex] = (ranges[rangeIndex] ?? 0) | (1 << bitOffset);
  }
  const [first, second, third, fourth] = ranges;
  return [first ?? 0, second ?? 0, third ?? 0, fourth ?? 0];
}
