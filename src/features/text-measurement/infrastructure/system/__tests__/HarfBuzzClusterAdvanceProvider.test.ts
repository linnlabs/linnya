import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { openSync } from 'fontkit';
import type { FontKitFont } from 'fontkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointsToInches } from '../../../index.js';
import type {
  FontFileLocator,
  NormalizedClusterAdvanceRequest,
  ResolvedFontFile,
} from '../../../index.js';
import { parseFontMetadata } from '../../../../font-resolution/functions/parseFontMetadata.js';
import { HarfBuzzClusterAdvanceProvider } from '../HarfBuzzClusterAdvanceProvider.js';
import { ensureHarfBuzzModule, resetHarfBuzzModuleForTests } from '../harfbuzzModule.js';

const requireFromRepo = createRequire(`${process.cwd()}/scripts/harfbuzz-test-font.mjs`);
const DETERMINISTIC_TEST_FONT = 'katex/dist/fonts/KaTeX_Main-Regular.ttf';
const GOLDEN_ADVANCES = [0.051, 0.046333, 0.041667, 0.125] as const;
const SURROGATE_CLUSTER_GOLDEN_ADVANCES = [0.125, 0.041667, 0.118, 0.120333] as const;
const sourceFontPath = requireFromRepo.resolve(DETERMINISTIC_TEST_FONT);

describe('HarfBuzzClusterAdvanceProvider', () => {
  let tempDir: string;
  let tempFontPath: string;
  let resolvedFont: ResolvedFontFile;

  beforeAll(async () => {
    await ensureHarfBuzzModule();
    tempDir = mkdtempSync(join(tmpdir(), 'linnya-harfbuzz-font-'));
    tempFontPath = join(tempDir, basename(sourceFontPath));
    copyFileSync(sourceFontPath, tempFontPath);
    const metadata = parseFontMetadata(tempFontPath);
    if (metadata == null) {
      throw new Error(`Unable to parse temporary test font: ${tempFontPath}`);
    }
    resolvedFont = {
      filePath: tempFontPath,
      faceIndex: metadata.faceIndex,
      postscriptName: metadata.postscriptName,
    };
    expect(resolvedFont.postscriptName).toBe('KaTeX_Main-Regular');
  });

  afterAll(() => {
    resetHarfBuzzModuleForTests();
    if (tempDir != null) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (tempFontPath != null && existsSync(tempFontPath)) {
      throw new Error(`Temporary HarfBuzz test font was not removed: ${tempFontPath}`);
    }
  });

  it('measures a single ASCII cluster from the font hmtx advance', () => {
    const provider = createProvider(resolvedFont);
    const request = createRequest(['A']);

    const result = provider.measureClusterAdvancesWithSource(request);

    expect(result.source).toBe('harfbuzz');
    expect(result.advances).toHaveLength(1);
    expect(result.advances[0]).toBeCloseTo(measureSingleGlyphAdvance('A', tempFontPath, 12), 6);
  });

  it('matches the committed golden advances for a deterministic dependency font', () => {
    const provider = createProvider(resolvedFont);
    const request = createRequest(['f', 'i', ' ', 'A']);

    const first = provider.measureClusterAdvancesWithSource(request);
    const second = provider.measureClusterAdvancesWithSource(request);

    expect(first.source).toBe('harfbuzz');
    expect(first.advances).toHaveLength(request.clusters.length);
    expect(first.advances).toEqual([...GOLDEN_ADVANCES]);
    expect(JSON.stringify(second.advances)).toBe(JSON.stringify(first.advances));
  });

  it('keeps UTF-16 cluster offsets stable for surrogate-pair clusters', () => {
    const provider = createProvider(resolvedFont);
    const request = createRequest(['A', '😀', 'B', 'C']);

    const result = provider.measureClusterAdvancesWithSource(request);

    expect(result.source).toBe('harfbuzz');
    expect(result.advances).toEqual([...SURROGATE_CLUSTER_GOLDEN_ADVANCES]);
  });

  it('applies letter spacing with the existing cluster contract', () => {
    const provider = createProvider(resolvedFont);
    const base = provider.measureClusterAdvancesWithSource(createRequest(['A', 'B'], 0));
    const spaced = provider.measureClusterAdvancesWithSource(createRequest(['A', 'B'], 2));

    expect(spaced.source).toBe('harfbuzz');
    expect(spaced.advances[0]).toBeCloseTo(base.advances[0] ?? 0, 6);
    expect((spaced.advances[1] ?? 0) - (base.advances[1] ?? 0)).toBeCloseTo(pointsToInches(2), 6);
  });

  it('falls back truthfully when the font locator misses', () => {
    const provider = new HarfBuzzClusterAdvanceProvider({
      fontFileLocator: {
        locate: () => undefined,
      },
    });

    const result = provider.measureClusterAdvancesWithSource(createRequest(['A', 'B']));

    expect(result.source).toBe('heuristic');
    expect(result.advances).toHaveLength(2);
    expect(result.advances.every((advance) => advance > 0)).toBe(true);
  });
});

function createProvider(resolvedFont: ResolvedFontFile): HarfBuzzClusterAdvanceProvider {
  const locator: FontFileLocator = {
    locate: () => resolvedFont,
  };
  return new HarfBuzzClusterAdvanceProvider({ fontFileLocator: locator });
}

function createRequest(
  clusters: readonly string[],
  letterSpacingPt = 0,
): NormalizedClusterAdvanceRequest {
  return {
    clusters,
    style: {
      fontFamily: 'Fixture Sans',
      fontSizePt: 12,
      lineHeightMultiplier: 1.2,
      bold: false,
      italic: false,
      letterSpacingPt,
    },
    sourceKind: 'generated',
  };
}

function measureSingleGlyphAdvance(text: string, fontPath: string, fontSizePt: number): number {
  const opened = openSync(fontPath);
  if (isFontCollection(opened)) {
    throw new Error('HarfBuzz provider test expects a single-face font.');
  }
  const codePoint = text.codePointAt(0);
  if (codePoint == null) {
    throw new Error('Cannot measure empty glyph.');
  }
  const glyph = opened.glyphForCodePoint(codePoint);
  return Number(((glyph.advanceWidth / opened.unitsPerEm) * pointsToInches(fontSizePt)).toFixed(6));
}

function isFontCollection(opened: FontKitFont | { readonly fonts: readonly FontKitFont[] }): opened is { readonly fonts: readonly FontKitFont[] } {
  return 'fonts' in opened;
}
