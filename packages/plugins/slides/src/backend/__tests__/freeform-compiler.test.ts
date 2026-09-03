import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DeckAssembler } from '../engine/DeckAssembler.js';
import { FreeformCompiler } from '../engine/FreeformCompiler.js';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import { PptxReader } from '../engine/parser/PptxReader.js';
import { PptxValidator } from '../engine/pptx/PptxValidator.js';
import type { DeckSpec, FreeformSlideSpec } from '@plugin/slides/shared';

const freeformCompiler = new FreeformCompiler();
const structuredCompiler = new StructuredCompiler();
const assembler = new DeckAssembler(structuredCompiler, freeformCompiler);
const reader = new PptxReader();
const validator = new PptxValidator();

function makeFreeformSlide(overrides?: Partial<FreeformSlideSpec>): FreeformSlideSpec {
  return {
    type: 'freeform',
    elements: [
      { type: 'text', position: { x: 1, y: 1, w: 8, h: 1 }, content: 'Hello Freeform' },
    ],
    ...overrides,
  };
}

async function readSlideXml(buffer: Buffer, slideNumber = 1): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntry = zip.file(`ppt/slides/slide${slideNumber}.xml`);
  if (slideEntry == null) {
    throw new Error(`Expected slide XML entry for slide ${slideNumber}`);
  }
  return slideEntry.async('text');
}

describe('FreeformCompiler', () => {
  it('keeps rich-run styles separate from the paragraph line spacing', async () => {
    const buffer = await freeformCompiler.compileDeck({
      title: 'Rich text spacing',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [{
            type: 'text',
            position: { x: 1, y: 1, w: 5, h: 1 },
            style: { lineSpacing: { kind: 'multiple', value: 1.18 } },
            content: [
              { text: 'First', style: { bold: true } },
              { text: ' second', style: { italic: true } },
            ],
          }],
        }),
      }],
    });
    const xml = await readSlideXml(buffer);

    expect(xml.match(/<a:lnSpc>/gu)).toHaveLength(1);
    expect(xml).toContain('<a:spcPct val="118000"/>');
  });
  it('compiles a text element', async () => {
    const deck: DeckSpec = {
      title: 'Freeform Text',
      slides: [{ slideNumber: 1, spec: makeFreeformSlide() }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    expect(buffer.length).toBeGreaterThan(0);

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
  });

  it('writes intrinsic-width text as an unwrapped PowerPoint text box', async () => {
    const buffer = await freeformCompiler.compileDeck({
      title: 'Intrinsic text box',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [{
            type: 'text',
            content: '01',
            position: { x: 8.8, y: 0.3, w: 0.37, h: 0.24 },
            textWrap: 'none',
          }],
        }),
      }],
    });

    const slideXml = await readSlideXml(buffer);

    expect(slideXml).toContain('<a:bodyPr wrap="none"');
    expect(slideXml).toContain('<a:spAutoFit/>');
  });

  it('compiles a shape element', async () => {
    const deck: DeckSpec = {
      title: 'Freeform Shape',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            { type: 'shape', geometry: 'rect', position: { x: 1, y: 1, w: 3, h: 2 }, style: { fill: '#FF0000' } },
          ],
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    const v = await validator.validate(buffer);
    expect(v.valid).toBe(true);
  });

  it('exports shape fill gradients as native OOXML gradFill', async () => {
    const deck: DeckSpec = {
      title: 'Freeform Shape Gradient',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            {
              type: 'shape',
              geometry: 'rect',
              position: { x: 1, y: 1, w: 3, h: 2 },
              style: {
                gradient: {
                  type: 'linear',
                  angle: 45,
                  stops: [
                    { color: '#102030', position: 0 },
                    { color: '#34D399', position: 1 },
                  ],
                },
              },
            },
          ],
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('<a:gradFill rotWithShape="1">');
    expect(slideXml).toContain('<a:srgbClr val="102030"/>');
    expect(slideXml).toContain('<a:srgbClr val="34D399"/>');
  });

  it('round-trips native background, shape fill, stroke and stop opacity as Paint', async () => {
    const deck: DeckSpec = {
      title: 'Native Paint Round Trip',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          background: {
            paint: {
              type: 'radial',
              center: { x: 0.3, y: 0.7 },
              radius: { x: 0.25, y: 0.4 },
              stops: [
                { color: '#FFFFFF', position: 0 },
                { color: '#102030', position: 1 },
              ],
            },
          },
          elements: [{
            type: 'shape',
            geometry: 'rect',
            position: { x: 1, y: 1, w: 3, h: 2 },
            style: {
              paint: {
                type: 'linear',
                angle: 45,
                stops: [
                  { color: '#FF0000', position: 0 },
                  { color: '#00FF00', position: 0.5, opacity: 0.4 },
                  { color: '#0000FF', position: 1 },
                ],
              },
              border: {
                width: 2,
                paint: {
                  type: 'linear',
                  angle: 90,
                  stops: [
                    { color: '#111111', position: 0 },
                    { color: '#EEEEEE', position: 1 },
                  ],
                },
              },
            },
          }],
        }),
      }],
    };

    const buffer = await freeformCompiler.compileDeck(deck);
    const info = await reader.parse(buffer);
    const shape = info.slides[0].elements.find((element) => element.type === 'shape');

    expect(info.slides[0].backgroundPaint).toMatchObject({
      type: 'radial',
      center: { x: 0.3, y: 0.7 },
      radius: { x: 0.25, y: 0.4 },
    });
    expect(shape?.shapeVisual?.paint).toMatchObject({
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#FF0000', position: 0 },
        { color: '#00FF00', position: 0.5, opacity: 0.4 },
        { color: '#0000FF', position: 1 },
      ],
    });
    expect(shape?.shapeVisual?.border?.paint).toMatchObject({ type: 'linear', angle: 90 });
    expect(shape?.shapeVisual?.border?.width).toBe(2);
  });

  it('compiles a shape with text content', async () => {
    const deck: DeckSpec = {
      title: 'Shape Text',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            { type: 'shape', geometry: 'ellipse', position: { x: 2, y: 2, w: 4, h: 2 }, style: { fill: '#00FF00' }, content: 'Inside' },
          ],
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
  });

  it('writes shape inner text fit, wrap, and margins through the freeform compiler', async () => {
    const deck: DeckSpec = {
      title: 'Shape Text Layout',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            { type: 'shape', geometry: 'rect', position: { x: 1, y: 1, w: 3, h: 1 }, content: 'Inside' },
          ],
        }),
      }],
    };

    const buffer = await freeformCompiler.compileDeck(deck);
    const slideXml = await readSlideXml(buffer);

    expect(slideXml).toContain(
      '<a:bodyPr wrap="square" lIns="101600" tIns="76200" rIns="101600" bIns="76200"',
    );
    expect(slideXml).toContain('<a:normAutofit/>');
  });

  it('compiles background and notes', async () => {
    const deck: DeckSpec = {
      title: 'BG Notes',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          background: { color: '#333333' },
          notes: 'Speaker note here',
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toBeTruthy();
  });

  it('compiles deterministic gradient background through shared renderer', async () => {
    const deck: DeckSpec = {
      title: 'Gradient BG',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          background: {
            gradient: {
              type: 'linear',
              angle: 135,
              stops: [
                { color: '#101820', position: 0 },
                { color: '#2A9D8F', position: 1 },
              ],
            },
          },
          elements: [],
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('applies group position and size to children during compilation', async () => {
    const deck: DeckSpec = {
      title: 'Group',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            {
              type: 'group',
              position: { x: 1, y: 1, w: 6, h: 2 },
              children: [
                { type: 'text', position: { x: 0, y: 0, w: 4, h: 1 }, content: 'Child 1' },
                { type: 'shape', geometry: 'rect', position: { x: 4, y: 0, w: 4, h: 1 }, style: { fill: '#0000FF' } },
              ],
            },
          ],
        }),
      }],
    };
    const buffer = await freeformCompiler.compileDeck(deck);
    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
    const text = info.slides[0].elements.find((element) => element.text === 'Child 1');
    const shape = info.slides[0].elements.find((element) => element.type === 'shape');
    expect(text?.position).toMatchObject({ x: 1, y: 1, w: 3, h: 2 });
    expect(shape?.position).toMatchObject({ x: 4, y: 1, w: 3, h: 2 });
  });

  it('throws for structured slides', async () => {
    const deck: DeckSpec = {
      title: 'Bad',
      slides: [{
        slideNumber: 1,
        spec: { type: 'structured', elements: [{ type: 'title', content: 'X', position: { x: 1, y: 1, w: 8, h: 1 } }] },
      }],
    };
    await expect(freeformCompiler.compileDeck(deck)).rejects.toThrow('Structured slides');
  });

  it('compiles image element from source-ref object', async () => {
    const deck: DeckSpec = {
      title: 'Freeform Image Source Ref',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            {
              type: 'image',
              position: { x: 1, y: 1, w: 2.5, h: 2.5 },
              src: {
                kind: 'data_uri',
                dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              },
              fitMode: 'contain',
              rounding: true,
            },
          ],
        }),
      }],
    };

    const buffer = await freeformCompiler.compileDeck(deck);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('fails fast on non-canonical colors before passing data into PptxGenJS', async () => {
    const deck: DeckSpec = {
      title: 'Invalid Color',
      slides: [{
        slideNumber: 1,
        spec: makeFreeformSlide({
          elements: [
            {
              type: 'shape',
              geometry: 'rect',
              position: { x: 1, y: 1, w: 3, h: 2 },
              style: { fill: 'rgba(255,255,255,0.08)' },
            },
          ],
        }),
      }],
    };

    await expect(freeformCompiler.compileDeck(deck)).rejects.toThrow(
      'paint.color 必须是十六进制颜色（#RGB 或 #RRGGBB），实际收到 "rgba(255,255,255,0.08)"。',
    );
  });
});

describe('DeckAssembler — mixed deck', () => {
  it('assembles a deck with both structured and freeform slides', async () => {
    const deck: DeckSpec = {
      title: 'Mixed Deck',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [{ type: 'title', content: 'Structured Slide', position: { x: 1, y: 1, w: 8, h: 1 } }],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'freeform',
            elements: [{ type: 'text', position: { x: 1, y: 1, w: 8, h: 1 }, content: 'Freeform Slide' }],
          },
        },
      ],
    };

    const buffer = await assembler.assemble(deck);
    expect(buffer.length).toBeGreaterThan(0);

    const v = await validator.validate(buffer);
    expect(v.valid).toBe(true);
    expect(v.structure.slideCount).toBe(2);
    expect(v.structure.missingOverrideParts).toEqual([]);

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(2);

    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
    expect(contentTypes).toContain('/ppt/slideMasters/slideMaster1.xml');
    expect(contentTypes).not.toContain('/ppt/slideMasters/slideMaster2.xml');
  });

  it('assembles a pure structured deck (no freeform)', async () => {
    const deck: DeckSpec = {
      title: 'Pure Structured',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{ type: 'title', content: 'Hello', position: { x: 1, y: 1, w: 8, h: 1 } }],
        },
      }],
    };
    const buffer = await assembler.assemble(deck);
    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
  });
});
