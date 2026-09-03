import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import type { DeckSpec } from '@plugin/slides/shared';
import { DeckAssembler } from './DeckAssembler';
import type {
  FreeformCompilerPort,
  ImageSourceResolverPort,
  StructuredCompilerPort,
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from './types';
import { StructuredCompiler } from './StructuredCompiler';
import { FreeformCompiler } from './FreeformCompiler';

describe('DeckAssembler image materialization', () => {
  it('只改写编译副本，保留作者 DeckSpec 中的图片引用', async () => {
    const deckSpec: DeckSpec = {
      title: 'owned image',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              {
                type: 'image',
                src: '/tmp/author-source.png',
                position: { x: 0, y: 0, w: 2, h: 2 },
              },
            ],
          },
        },
      ],
    };
    let compiledDeck: DeckSpec | null = null;
    const structuredCompiler: StructuredCompilerPort = {
      compileSlide() {},
      async compileDeck(input) {
        compiledDeck = input;
        return Buffer.from('pptx');
      },
    };
    const freeformCompiler: FreeformCompilerPort = {
      compileSlide() {},
    };
    const imageSourceResolver: ImageSourceResolverPort = {
      async resolveImageSource() {
        return { kind: 'data_uri', dataUri: 'data:image/png;base64,AAAA' };
      },
    };

    await new DeckAssembler(structuredCompiler, freeformCompiler, imageSourceResolver).assemble(
      deckSpec,
      { assetContext: { documentId: 'presentation-1' } }
    );

    expect(deckSpec.slides[0].spec.elements[0]).toMatchObject({
      src: '/tmp/author-source.png',
    });
    if (!compiledDeck) throw new Error('structured compiler was not called');
    expect(compiledDeck.slides[0].spec.elements[0]).toMatchObject({
      src: { kind: 'data_uri', dataUri: 'data:image/png;base64,AAAA' },
    });
  });

  it('读取 owned SVG 并以原生 SVG 媒体写入 PPTX，不污染 DeckSpec', async () => {
    const canonicalSvg = '<svg viewBox="0 0 100 50"><path d="M0 25L100 25" stroke="#2563EB" stroke-width="4"/></svg>';
    const assetRef = {
      kind: 'owned_svg' as const,
      assetId: 'svg-asset-1',
      contentHash: createHash('sha256').update(canonicalSvg).digest('hex'),
      byteLength: 111,
      viewBox: { width: 100, height: 50 },
    };
    const deckSpec: DeckSpec = {
      title: 'native svg',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'svgGraphic',
            asset: assetRef,
            position: { x: 1, y: 1, w: 6, h: 3 },
            fit: 'contain',
            altText: '蓝色流程线',
          }],
        },
      }],
    };
    const svgResolver: SvgGraphicAssetResolverPort = {
      async resolveSvgGraphicAsset() {
        return { ...assetRef, canonicalSvg };
      },
    };
    const fallbackRasterizer: SvgGraphicFallbackRasterizerPort = {
      async rasterizeSvgGraphic() {
        return {
          pngBytes: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y5WQAAAABJRU5ErkJggg==',
            'base64',
          ),
          widthPx: 1,
          heightPx: 1,
        };
      },
    };
    const assembler = new DeckAssembler(
      new StructuredCompiler(),
      new FreeformCompiler(),
      undefined,
      undefined,
      svgResolver,
      fallbackRasterizer,
    );

    const buffer = await assembler.assemble(deckSpec, {
      assetContext: { documentId: 'presentation-1' },
    });
    const zip = await JSZip.loadAsync(buffer);
    const svgPart = Object.keys(zip.files).find(name => name.endsWith('.svg'));

    expect(svgPart).toBeDefined();
    expect(await zip.file(svgPart ?? '')?.async('text')).toBe(canonicalSvg);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).toContain('asvg:svgBlip');
    expect(slideXml).toContain('Linnya SVG Graphic 1-1');
    expect(JSON.stringify(deckSpec)).not.toContain(canonicalSvg);
  });
});
