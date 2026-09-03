import { describe, expect, it, vi } from 'vitest';

import type { FontMetadata } from '../../definitions/types.js';
import {
  FontCatalogQueryService,
  type FontCatalogQueryPort,
} from '../FontCatalogQueryService.js';

const LATIN_RANGES = rangesWithBits([0, 1]);
const CJK_AND_LATIN_RANGES = rangesWithBits([0, 1, 59]);

describe('FontCatalogQueryService', () => {
  it('精确检查不受候选分页截断影响，并返回聚合后的客观族信息', async () => {
    const fonts = [
      makeMeta({ family: 'Alpha Sans', postscriptName: 'AlphaSans-Regular' }),
      makeMeta({ family: 'Target Sans', postscriptName: 'TargetSans-Regular' }),
      makeMeta({
        family: 'Target Sans',
        postscriptName: 'TargetSans-BoldItalic',
        bold: true,
        italic: true,
        isFixedPitch: true,
        unicodeRanges: CJK_AND_LATIN_RANGES,
      }),
    ];
    const service = new FontCatalogQueryService(createCatalog(fonts));

    await expect(service.checkFamily(' target sans ')).resolves.toEqual({
      requestedFamily: 'target sans',
      installed: true,
      match: {
        family: 'Target Sans',
        scripts: ['latin', 'eastAsian'],
        styles: ['regular', 'bold', 'italic'],
        monospace: true,
      },
    });
  });

  it('候选按 family 稳定排序、去重并分页，结果不泄漏字体文件信息', async () => {
    const fonts = [
      makeMeta({ family: 'Zulu Sans', postscriptName: 'ZuluSans-Regular' }),
      makeMeta({ family: 'Alpha Sans', postscriptName: 'AlphaSans-Regular' }),
      makeMeta({ family: 'Alpha Sans', postscriptName: 'AlphaSans-Bold', bold: true }),
      makeMeta({ family: '.Hidden UI', postscriptName: 'HiddenUI-Regular' }),
      makeMeta({
        family: 'CJK Only',
        postscriptName: 'CJKOnly-Regular',
        unicodeRanges: rangesWithBits([59]),
      }),
    ];
    const service = new FontCatalogQueryService(createCatalog(fonts));

    const result = await service.listFamilies({ script: 'latin', offset: 1, limit: 1 });

    expect(result).toEqual({
      script: 'latin',
      offset: 1,
      limit: 1,
      total: 2,
      hasMore: false,
      families: [{
        family: 'Zulu Sans',
        scripts: ['latin'],
        styles: ['regular'],
        monospace: false,
      }],
    });
    expect(JSON.stringify(result)).not.toContain('/fonts/');
    expect(JSON.stringify(result)).not.toContain('postscriptName');
    expect(JSON.stringify(result)).not.toContain('.Hidden UI');
  });

  it('所有查询都会先等待目录终态', async () => {
    const waitUntilReady = vi.fn(async () => undefined);
    const service = new FontCatalogQueryService({
      ...createCatalog([]),
      waitUntilReady,
    });

    await service.checkFamily('Missing Sans');
    await service.listFamilies({ script: 'latin', offset: 0, limit: 10 });

    expect(waitUntilReady).toHaveBeenCalledTimes(2);
  });

  it('拒绝无界候选查询', async () => {
    const service = new FontCatalogQueryService(createCatalog([]));

    await expect(service.listFamilies({ script: 'latin', offset: -1, limit: 10 }))
      .rejects.toThrow('offset');
    await expect(service.listFamilies({ script: 'latin', offset: 0, limit: 101 }))
      .rejects.toThrow('limit');
  });
});

function createCatalog(fonts: readonly FontMetadata[]): FontCatalogQueryPort {
  return {
    waitUntilReady: async () => undefined,
    findByFamily: (family) => fonts.filter((font) => (
      font.family.toLocaleLowerCase('en-US') === family.trim().toLocaleLowerCase('en-US')
    )),
    allFonts: () => fonts,
  };
}

function makeMeta(overrides: Partial<FontMetadata> = {}): FontMetadata {
  return {
    family: 'Mock Sans',
    subfamily: 'Regular',
    postscriptName: 'MockSans-Regular',
    filePath: '/fonts/mock.ttf',
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
