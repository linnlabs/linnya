import { afterEach, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import type { DeckSpec } from '@plugin/slides/shared';
import { RenderModelMapper } from '../../parser/RenderModelMapper.js';
import {
  collectClusterAdvanceRequestsForRenderModel,
  fontMetadataToLineMetrics,
} from '../renderModelTextLayout.js';
import type { FontMetadata, ScriptClass } from 'src/features/font-resolution';
import {
  configureDefaultFontResolutionService,
  resetDefaultFontResolutionService,
} from 'src/features/font-resolution';
import { extractParagraphInfo } from '../../parser/xml/TextBodyParser.js';
import { getElementByTag } from '../../parser/xml/XmlNode.js';

const LATIN_RANGES = rangesWithBits([0, 1]);
const FACE_FINGERPRINT = 'b'.repeat(64);

describe('Slides font resolution integration', () => {
  afterEach(() => {
    resetDefaultFontResolutionService();
  });

  it('preserves original fontFamily while layout prewarm consumes resolvedFontFamily', () => {
    configureDefaultFontResolutionService({
      catalog: new FakeFontCatalog([
        makeMeta({
          family: 'Resolved Sans',
          postscriptName: 'ResolvedSans-Regular',
        }),
      ]),
    });

    const deckSpec: DeckSpec = {
      title: 'Font resolution',
      layout: '16x9',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'text',
            content: 'Generated font resolution',
            position: { x: 1, y: 1, w: 4, h: 1 },
            style: {
              fontFamily: 'Missing Sans',
              fontSize: 18,
            },
          }],
        },
      }],
    };

    const renderModel = new RenderModelMapper().fromGeneratedDeck(
      'deck-1',
      1,
      'Font resolution',
      deckSpec,
      { width: 13.333, height: 7.5 },
    );
    const firstNode = renderModel.slides[0]?.elements[0];
    expect(firstNode?.kind).toBe('text');
    if (firstNode?.kind !== 'text') {
      throw new Error('expected text render node');
    }

    const firstRun = firstNode.paragraphs[0]?.runs[0];
    expect(firstRun?.fontFamily).toBe('Missing Sans');
    expect(firstRun?.resolvedFontFamily).toBe('Resolved Sans');
    expect(firstRun?.fontScript).toBe('latin');
    expect(firstRun?.fontResolution).toBe('substituted');
    expect(firstRun?.fontFaceFingerprint).toBe(FACE_FINGERPRINT);
    expect(firstRun?.resolvedFontWeight).toBe('normal');
    expect(firstRun?.resolvedFontStyle).toBe('normal');

    const requests = collectClusterAdvanceRequestsForRenderModel(renderModel);
    expect(requests[0]?.style.fontFamily).toBe('Resolved Sans');
  });

  it('attaches platform font resolution facts to imported OOXML runs', () => {
    configureDefaultFontResolutionService({
      catalog: new FakeFontCatalog([
        makeMeta({
          family: 'Resolved Sans',
          postscriptName: 'ResolvedSans-Bold',
          bold: true,
        }),
      ]),
    });
    const document = new DOMParser().parseFromString(`
      <p:txBody
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      >
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:r>
            <a:rPr b="1"><a:latin typeface="Missing Sans"/></a:rPr>
            <a:t>Imported font</a:t>
          </a:r>
        </a:p>
      </p:txBody>
    `, 'application/xml');
    const txBody = getElementByTag(document, 'p:txBody');
    if (!txBody) throw new Error('expected txBody fixture');

    const run = extractParagraphInfo(txBody, {
      colors: {},
      fonts: { major: 'Missing Sans', minor: 'Missing Sans' },
    })?.[0]?.runs[0];

    expect(run).toMatchObject({
      text: 'Imported font',
      fontFamily: 'Missing Sans',
      resolvedFontFamily: 'Resolved Sans',
      fontScript: 'latin',
      fontResolution: 'substituted',
      fontFaceFingerprint: FACE_FINGERPRINT,
      resolvedBold: true,
      resolvedItalic: false,
      bold: true,
    });
  });

  it('prewarm uses the actual resolved face style when no matching requested style exists', () => {
    configureDefaultFontResolutionService({
      catalog: new FakeFontCatalog([
        makeMeta({
          family: 'Resolved CJK',
          postscriptName: 'ResolvedCJK-Bold',
          unicodeRanges: rangesWithBits([0, 59]),
          bold: true,
        }),
      ]),
    });
    const deckSpec: DeckSpec = {
      title: 'Resolved style',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'text',
            content: '中文',
            position: { x: 1, y: 1, w: 4, h: 1 },
            style: { fontFamily: 'Missing CJK', fontSize: 18 },
          }],
        },
      }],
    };

    const renderModel = new RenderModelMapper().fromGeneratedDeck(
      'deck-resolved-style',
      1,
      'Resolved style',
      deckSpec,
      { width: 13.333, height: 7.5 },
    );
    const node = renderModel.slides[0]?.elements[0];
    if (node?.kind !== 'text') throw new Error('expected text render node');

    expect(node.paragraphs[0]?.runs[0]).toMatchObject({
      fontWeight: undefined,
      resolvedFontWeight: 'bold',
    });
    expect(collectClusterAdvanceRequestsForRenderModel(renderModel)[0]?.style.bold).toBe(true);
  });

  it('generated run 用实际 cmap 拒绝只有 CJK 标点覆盖的精确 family', () => {
    configureDefaultFontResolutionService({
      catalog: new FakeFontCatalog([
        makeMeta({
          family: 'Punctuation Sans',
          postscriptName: 'PunctuationSans-Regular',
          unicodeRanges: rangesWithBits([0, 48]),
          glyphCodePointRanges: [[0, 0x007F], [0x3000, 0x303F]],
        }),
        makeMeta({
          family: 'Ideograph Sans',
          postscriptName: 'IdeographSans-Regular',
          unicodeRanges: rangesWithBits([0, 59]),
          glyphCodePointRanges: [[0, 0x10FFFF]],
        }),
      ]),
    });
    const deckSpec: DeckSpec = {
      title: 'CJK coverage',
      layout: '16x9',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'text',
            content: '中文',
            position: { x: 1, y: 1, w: 4, h: 1 },
            style: { fontFamily: 'Punctuation Sans', fontSize: 18 },
          }],
        },
      }],
    };

    const renderModel = new RenderModelMapper().fromGeneratedDeck(
      'deck-cjk',
      1,
      'CJK coverage',
      deckSpec,
      { width: 13.333, height: 7.5 },
    );
    const node = renderModel.slides[0]?.elements[0];
    if (node?.kind !== 'text') throw new Error('expected text render node');

    expect(node.paragraphs[0]?.runs[0]).toMatchObject({
      fontFamily: 'Punctuation Sans',
      resolvedFontFamily: 'Ideograph Sans',
      fontScript: 'eastAsian',
      fontResolution: 'substituted',
    });
  });

  it('converts OS/2 win metrics into line metrics', () => {
    const metrics = fontMetadataToLineMetrics(makeMeta(), {
      fontFamily: 'Resolved Sans',
      fontSizePt: 20,
      bold: false,
      italic: false,
      script: 'latin',
    });

    expect(metrics.ascent).toBeCloseTo(0.9 * 20 / 72, 6);
    expect(metrics.descent).toBeCloseTo(0.2 * 20 / 72, 6);
    expect(metrics.lineGap).toBe(0);
  });

  it('uses OS/2 typo metrics when USE_TYPO_METRICS is set', () => {
    const metrics = fontMetadataToLineMetrics(makeMeta({ useTypoMetrics: true }), {
      fontFamily: 'Resolved Sans',
      fontSizePt: 20,
      bold: false,
      italic: false,
      script: 'latin',
    });

    expect(metrics.ascent).toBeCloseTo(0.75 * 20 / 72, 6);
    expect(metrics.descent).toBeCloseTo(0.25 * 20 / 72, 6);
    expect(metrics.lineGap).toBeCloseTo(0.2 * 20 / 72, 6);
  });

  it('keeps east Asian font metrics in the same OS/2 coordinate system', () => {
    const metrics = fontMetadataToLineMetrics(makeMeta(), {
      fontFamily: 'Resolved Sans',
      fontSizePt: 20,
      bold: false,
      italic: false,
      script: 'eastAsian',
    });

    expect(metrics.ascent).toBeCloseTo(0.9 * 20 / 72, 6);
    expect(metrics.descent).toBeCloseTo(0.2 * 20 / 72, 6);
    expect(metrics.lineGap).toBe(0);
  });
});

class FakeFontCatalog {
  constructor(private readonly fonts: readonly FontMetadata[]) {}

  isReady(): boolean {
    return true;
  }

  findByFamily(family: string): readonly FontMetadata[] {
    const normalized = normalizeFamilyName(family);
    return this.fonts.filter((font) => normalizeFamilyName(font.family) === normalized);
  }

  candidatesForScript(script: ScriptClass): readonly FontMetadata[] {
    const bits = script === 'eastAsian' ? [48, 59] : script === 'complex' ? [13] : [0, 1];
    return this.fonts.filter((font) => bits.some((bit) => hasRangeBit(font, bit)));
  }
}

function hasRangeBit(font: FontMetadata, bit: number): boolean {
  const range = font.unicodeRanges[Math.floor(bit / 32)];
  return range != null && (range & (1 << (bit % 32))) !== 0;
}

function makeMeta(overrides: Partial<FontMetadata> = {}): FontMetadata {
  return {
    family: 'Resolved Sans',
    subfamily: 'Regular',
    postscriptName: 'ResolvedSans-Regular',
    filePath: '/fonts/resolved-sans.ttf',
    faceIndex: 0,
    faceFingerprint: FACE_FINGERPRINT,
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
