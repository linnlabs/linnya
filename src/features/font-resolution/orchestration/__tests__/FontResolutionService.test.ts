import { describe, expect, it } from 'vitest';
import type { FontMetadata, FontRequest, ScriptClass } from '../../definitions/types.js';
import { hasScriptCoverage } from '../../functions/scriptCoverage.js';
import type { FontResolutionCatalog } from '../FontResolutionService.js';
import { FontResolutionService, type FontSubstitutionScorer } from '../FontResolutionService.js';

const LATIN_RANGES = rangesWithBits([0, 1]);
const CJK_RANGES = rangesWithBits([59]);

describe('FontResolutionService', () => {
  it('系统字体目录未就绪时沿用原始请求名，并标记 catalogReady=false', () => {
    const service = new FontResolutionService({
      catalog: new FakeCatalog([], false),
    });
    const request = makeRequest({ family: 'Pending Font' });

    const resolved = service.resolve(request);

    expect(resolved).toMatchObject({
      request,
      resolvedFamily: 'Pending Font',
      catalogReady: false,
      exactMatch: true,
      penalty: null,
      resolution: 'not-ready',
    });
    expect(resolved.resolved).toBeUndefined();
  });

  it('精确 family 命中时返回原字体 face，并保持 exactMatch=true', () => {
    const notoSans = makeMeta({
      family: 'Noto Sans',
      postscriptName: 'NotoSans-Regular',
    });
    const service = new FontResolutionService({
      catalog: new FakeCatalog([notoSans]),
    });

    const resolved = service.resolve(makeRequest({ family: 'Noto Sans' }));

    expect(resolved.catalogReady).toBe(true);
    expect(resolved.exactMatch).toBe(true);
    expect(resolved.resolution).toBe('exact');
    expect(resolved.resolvedFamily).toBe('Noto Sans');
    expect(resolved.resolved).toBe(notoSans);
    expect(resolved.penalty).toBe(0);
  });

  it('请求字体缺失时，从主导脚本候选池里选择 penalty 最低的替代字体', () => {
    const weakCandidate = makeMeta({
      family: 'Weak Sans',
      postscriptName: 'WeakSans-Regular',
    });
    const bestCandidate = makeMeta({
      family: 'Best Sans',
      postscriptName: 'BestSans-Regular',
    });
    const cjkOnly = makeMeta({
      family: 'CJK Sans',
      postscriptName: 'CJKSans-Regular',
      unicodeRanges: CJK_RANGES,
      avgCharWidth: 1,
    });
    const scorer: FontSubstitutionScorer = (_request, candidate) => {
      if (candidate.family === 'Best Sans') {
        return 10;
      }
      if (candidate.family === 'Weak Sans') {
        return 20;
      }
      return 1;
    };
    const service = new FontResolutionService({
      catalog: new FakeCatalog([weakCandidate, bestCandidate, cjkOnly]),
      scoreSubstitution: scorer,
    });

    const resolved = service.resolve(makeRequest({ family: 'NotInstalled Font', script: 'latin' }));

    expect(resolved.catalogReady).toBe(true);
    expect(resolved.exactMatch).toBe(false);
    expect(resolved.resolution).toBe('substituted');
    expect(resolved.resolvedFamily).toBe('Best Sans');
    expect(resolved.resolved).toBe(bestCandidate);
    expect(resolved.penalty).toBe(10);
  });

  it('相同请求二次解析命中服务内缓存，不重复调用 scorer', () => {
    const first = makeMeta({
      family: 'First Sans',
      postscriptName: 'FirstSans-Regular',
    });
    const second = makeMeta({
      family: 'Second Sans',
      postscriptName: 'SecondSans-Regular',
    });
    let scorerCalls = 0;
    const scorer: FontSubstitutionScorer = (_request, candidate) => {
      scorerCalls += 1;
      return candidate.family === 'Second Sans' ? 5 : 50;
    };
    const service = new FontResolutionService({
      catalog: new FakeCatalog([first, second]),
      scoreSubstitution: scorer,
    });
    const request = makeRequest({ family: 'Missing Sans', script: 'latin' });

    const firstResolved = service.resolve(request);
    const secondResolved = service.resolve(request);

    expect(firstResolved.resolvedFamily).toBe('Second Sans');
    expect(secondResolved).toBe(firstResolved);
    expect(scorerCalls).toBe(2);
  });

  it('目录已就绪但脚本候选池为空时，返回可观察的 unresolved 结果', () => {
    const service = new FontResolutionService({
      catalog: new FakeCatalog([makeMeta({
        family: 'Latin Sans',
        postscriptName: 'LatinSans-Regular',
        unicodeRanges: LATIN_RANGES,
      })]),
    });

    const resolved = service.resolve(makeRequest({ family: 'Missing CJK', script: 'eastAsian' }));

    expect(resolved).toMatchObject({
      resolvedFamily: 'Missing CJK',
      catalogReady: true,
      exactMatch: false,
      penalty: null,
      resolution: 'unresolved',
    });
    expect(resolved.resolved).toBeUndefined();
  });

  it('精确 family 的 cmap 不覆盖当前正文时改选真正覆盖正文的字体', () => {
    const requestedLatinOnly = makeMeta({
      family: 'Requested Sans',
      postscriptName: 'RequestedSans-Regular',
      unicodeRanges: LATIN_RANGES,
      glyphCodePointRanges: [[0, 0x024F]],
    });
    const cjkCandidate = makeMeta({
      family: 'CJK Sans',
      postscriptName: 'CJKSans-Regular',
      unicodeRanges: rangesWithBits([0, 59]),
      glyphCodePointRanges: [[0, 0x10FFFF]],
    });
    const service = new FontResolutionService({
      catalog: new FakeCatalog([requestedLatinOnly, cjkCandidate]),
      scoreSubstitution: (_request, candidate) => candidate.family === 'CJK Sans' ? 1 : 10,
    });

    const resolved = service.resolve(makeRequest({
      family: 'Requested Sans',
      script: 'eastAsian',
      requiredCodePoints: [0x0041, 0x4E2D],
    }));

    expect(resolved).toMatchObject({
      resolution: 'substituted',
      resolvedFamily: 'CJK Sans',
    });
  });

  it('请求 family 已安装但缺字时，使用原 face 元数据选择相近替代字体', () => {
    const requestedFace = makeMeta({
      family: 'Heiti SC',
      postscriptName: 'STHeitiSC-Medium',
      bold: true,
      avgCharWidth: 1,
      glyphCodePointRanges: [[0, 0x007F]],
    });
    const genericLatin = makeMeta({
      family: 'Gujarati MT',
      postscriptName: 'GujaratiMT-Bold',
      bold: true,
      avgCharWidth: 0.5,
    });
    const similarCjkSans = makeMeta({
      family: 'Hiragino Sans W6',
      postscriptName: 'HiraginoSans-W6',
      bold: true,
      avgCharWidth: 0.9,
    });
    const service = new FontResolutionService({
      catalog: new FakeCatalog([requestedFace, genericLatin, similarCjkSans]),
    });

    const resolved = service.resolve(makeRequest({
      family: 'Heiti SC',
      bold: true,
      requiredCodePoints: [0x2713],
    }));

    expect(resolved).toMatchObject({
      resolution: 'substituted',
      resolvedFamily: 'Hiragino Sans W6',
      resolved: { bold: true },
    });
  });

  it('候选 OS/2 声明不能替代正文要求的实际 cmap 覆盖', () => {
    const punctuationOnly = makeMeta({
      family: 'Punctuation Sans',
      postscriptName: 'PunctuationSans-Regular',
      unicodeRanges: rangesWithBits([0, 48]),
      glyphCodePointRanges: [[0, 0x007F], [0x3000, 0x303F]],
    });
    const ideograph = makeMeta({
      family: 'Ideograph Sans',
      postscriptName: 'IdeographSans-Regular',
      unicodeRanges: rangesWithBits([0, 59]),
      glyphCodePointRanges: [[0, 0x10FFFF]],
    });
    const service = new FontResolutionService({
      catalog: new FakeCatalog([punctuationOnly, ideograph]),
      scoreSubstitution: (_request, candidate) => (
        candidate.family === 'Punctuation Sans' ? 1 : 100
      ),
    });

    const resolved = service.resolve(makeRequest({
      family: 'Missing CJK',
      script: 'eastAsian',
      requiredCodePoints: [0x0041, 0x4E2D],
    }));

    expect(resolved.resolvedFamily).toBe('Ideograph Sans');
  });

  it('Heiti SC 未声明 CJK 标点 OS/2 bit 时仍按真实 cmap 保持精确命中', () => {
    const heiti = makeMeta({
      family: 'Heiti SC',
      postscriptName: 'STHeitiSC-Medium',
      unicodeRanges: rangesWithBits([0, 59]),
      glyphCodePointRanges: [[0, 0x10FFFF]],
      bold: true,
    });
    const service = new FontResolutionService({ catalog: new FakeCatalog([heiti]) });

    const resolved = service.resolve(makeRequest({
      family: 'Heiti SC',
      bold: true,
      script: 'eastAsian',
      requiredCodePoints: [0x0041, 0x4E2D, 0xFF0C],
    }));

    expect(resolved).toMatchObject({
      resolution: 'exact',
      resolvedFamily: 'Heiti SC',
      resolved: { postscriptName: 'STHeitiSC-Medium', bold: true },
    });
  });

  it('regular 请求优先选择 regular face，不让平均宽度优势把结果推到 bold face', () => {
    const regular = makeMeta({
      family: 'Hiragino Sans W4',
      postscriptName: 'HiraginoSans-W4',
      unicodeRanges: rangesWithBits([0, 48, 59]),
      avgCharWidth: 0.563,
      glyphCodePointRanges: [[0, 0x10FFFF]],
    });
    const bold = makeMeta({
      family: 'Hiragino Sans W9',
      postscriptName: 'HiraginoSans-W9',
      unicodeRanges: rangesWithBits([0, 48, 59]),
      avgCharWidth: 0.699,
      glyphCodePointRanges: [[0, 0x10FFFF]],
      bold: true,
    });
    const service = new FontResolutionService({ catalog: new FakeCatalog([regular, bold]) });

    const resolved = service.resolve(makeRequest({
      family: 'Missing CJK',
      script: 'eastAsian',
      requiredCodePoints: [0x4E2D, 0xFF0C],
    }));

    expect(resolved.resolved).toMatchObject({
      family: 'Hiragino Sans W4',
      bold: false,
    });
  });
});

class FakeCatalog implements FontResolutionCatalog {
  constructor(
    private readonly fonts: readonly FontMetadata[],
    private readonly ready = true,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  findByFamily(family: string): readonly FontMetadata[] {
    const normalized = normalizeFamilyName(family);
    return this.fonts.filter((font) => normalizeFamilyName(font.family) === normalized);
  }

  candidatesForScript(script: ScriptClass): readonly FontMetadata[] {
    return this.fonts.filter((font) => hasScriptCoverage(font, script));
  }
}

function makeRequest(overrides: Partial<FontRequest> = {}): FontRequest {
  return {
    family: 'Noto Sans',
    bold: false,
    italic: false,
    script: 'latin',
    ...overrides,
  };
}

function makeMeta(overrides: Partial<FontMetadata> = {}): FontMetadata {
  return {
    family: 'Noto Sans',
    subfamily: 'Regular',
    postscriptName: 'NotoSans-Regular',
    filePath: '/fonts/noto-sans.ttf',
    faceIndex: 0,
    panose: [2, 11, 5, 3, 2, 2, 4, 2, 2, 4],
    unicodeRanges: LATIN_RANGES,
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

function normalizeFamilyName(family: string): string {
  return family.trim().toLocaleLowerCase('en-US');
}
