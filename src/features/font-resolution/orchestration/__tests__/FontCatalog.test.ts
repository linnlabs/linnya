import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FontCatalogUnavailableError } from '../../definitions/fontCatalogQuery.js';
import type { FontMetadata } from '../../definitions/types.js';
import { FontCatalog } from '../FontCatalog.js';

const LATIN_RANGES = rangesWithBits([0, 1]);
const CJK_RANGES = rangesWithBits([59]);

describe('FontCatalog', () => {
  it('扫描字体目录并按 family 查询 metadata', async () => {
    const root = createTempDir();
    const fontPath = join(root, 'MockSans.ttf');
    writeFileSync(fontPath, 'fake font bytes');

    const catalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath: join(root, 'font-catalog-cache.json'),
      parseFontFileMetadata: (filePath) => [makeMeta({
        family: 'Mock Sans',
        postscriptName: 'MockSans-Regular',
        filePath,
      })],
    });

    await catalog.scan();

    expect(catalog.findByFamily('mock sans')).toHaveLength(1);
    expect(catalog.findByFamily('MockSans')).toEqual([]);
    expect(catalog.allFonts()).toHaveLength(1);
  });

  it('字体文件未变化时命中 metadata 缓存，不重新解析字体文件', async () => {
    const root = createTempDir();
    const fontPath = join(root, 'CachedSans.ttf');
    const cacheFilePath = join(root, 'font-catalog-cache.json');
    writeFileSync(fontPath, 'fake font bytes');

    let parseCount = 0;
    const firstCatalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath,
      parseFontFileMetadata: (filePath) => {
        parseCount += 1;
        return [makeMeta({
          family: 'Cached Sans',
          postscriptName: 'CachedSans-Regular',
          filePath,
        })];
      },
    });

    await firstCatalog.scan();
    expect(parseCount).toBe(1);

    const secondCatalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath,
      parseFontFileMetadata: () => {
        throw new Error('cache miss should not parse unchanged font files');
      },
    });

    await secondCatalog.scan();

    expect(secondCatalog.findByFamily('Cached Sans')).toHaveLength(1);
  });

  it('字体文件 mtime 或 size 变化时重新解析并更新缓存', async () => {
    const root = createTempDir();
    const fontPath = join(root, 'ChangingSans.ttf');
    const cacheFilePath = join(root, 'font-catalog-cache.json');
    writeFileSync(fontPath, 'first');

    let parseCount = 0;
    const catalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath,
      parseFontFileMetadata: (filePath) => {
        parseCount += 1;
        return [makeMeta({
          family: `Changing Sans ${parseCount}`,
          postscriptName: `ChangingSans-${parseCount}`,
          filePath,
        })];
      },
    });

    await catalog.scan();
    writeFileSync(fontPath, 'second version');
    await catalog.scan();

    expect(parseCount).toBe(2);
    expect(catalog.findByFamily('Changing Sans 2')).toHaveLength(1);
  });

  it('递归扫描 .ttf/.otf/.ttc，并按脚本覆盖返回候选池', async () => {
    const root = createTempDir();
    const nested = join(root, 'nested');
    mkdirSync(nested);
    writeFileSync(join(root, 'LatinSans.otf'), 'latin');
    writeFileSync(join(nested, 'CjkSans.ttc'), 'cjk collection');
    writeFileSync(join(root, 'HiddenSans.ttf'), 'hidden');
    writeFileSync(join(root, 'ignore.txt'), 'not a font');

    const catalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath: join(root, 'font-catalog-cache.json'),
      parseFontFileMetadata: (filePath) => {
        if (filePath.endsWith('LatinSans.otf')) {
          return [makeMeta({
            family: 'Latin Sans',
            postscriptName: 'LatinSans-Regular',
            filePath,
            unicodeRanges: LATIN_RANGES,
          })];
        }
        if (filePath.endsWith('HiddenSans.ttf')) {
          return [makeMeta({
            family: '.Hidden Sans',
            postscriptName: '.HiddenSans-Regular',
            filePath,
            unicodeRanges: LATIN_RANGES,
          })];
        }
        return [makeMeta({
          family: 'CJK Sans',
          postscriptName: 'CJKSans-Regular',
          filePath,
          unicodeRanges: CJK_RANGES,
          avgCharWidth: 1,
        })];
      },
    });

    await catalog.scan();

    expect(catalog.allFonts()).toHaveLength(3);
    expect(catalog.candidatesForScript('latin').map((font) => font.family)).toEqual(['Latin Sans']);
    expect(catalog.candidatesForScript('eastAsian').map((font) => font.family)).toEqual(['CJK Sans']);
  });

  it('查询等待正在进行的扫描，并在真实 ready 终态后继续', async () => {
    const root = createTempDir();
    const fontPath = join(root, 'WaitingSans.ttf');
    writeFileSync(fontPath, 'font');
    const catalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath: join(root, 'font-catalog-cache.json'),
      parseFontFileMetadata: (filePath) => [makeMeta({ filePath })],
    });

    const scan = catalog.scan();
    expect(catalog.getState()).toBe('scanning');
    const ready = catalog.waitUntilReady();
    await Promise.all([scan, ready]);

    expect(catalog.getState()).toBe('ready');
    expect(catalog.isReady()).toBe(true);
  });

  it('扫描失败进入 failed 终态，查询返回稳定错误而不是假空名单', async () => {
    const root = createTempDir();
    writeFileSync(join(root, 'Broken.ttf'), 'font');
    const catalog = new FontCatalog({
      scanRoots: [root],
      cacheFilePath: join(root, 'font-catalog-cache.json'),
      parseFontFileMetadata: () => {
        throw new Error('private parser details');
      },
    });

    const scan = catalog.scan();
    const ready = catalog.waitUntilReady();
    await expect(scan).rejects.toThrow('private parser details');
    await expect(ready).rejects.toEqual(new FontCatalogUnavailableError());
    expect(catalog.getState()).toBe('failed');
    await expect(catalog.waitUntilReady()).rejects.toEqual(new FontCatalogUnavailableError());
  });
});

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'linnya-font-catalog-'));
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
