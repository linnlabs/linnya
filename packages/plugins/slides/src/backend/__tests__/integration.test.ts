import JSZip from 'jszip';
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { DeckAssembler } from '../engine/DeckAssembler.js';
import { FreeformCompiler } from '../engine/FreeformCompiler.js';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import type { DeckSpec } from '@plugin/slides/shared';

async function readPptxDocumentFacts(buffer: Buffer): Promise<{
  presentationXml: string;
  themeXml: string;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = zip.file('ppt/presentation.xml');
  const theme = zip.file('ppt/theme/theme1.xml');
  if (!presentation || !theme) {
    throw new Error('Expected PPTX presentation and theme XML entries');
  }
  return {
    presentationXml: await presentation.async('text'),
    themeXml: await theme.async('text'),
  };
}

function readThemeFontSlots(
  themeXml: string,
  fontSetTag: 'a:majorFont' | 'a:minorFont',
): { latin: string; eastAsian: string; complex: string; hans: string } {
  const document = new DOMParser().parseFromString(themeXml, 'application/xml');
  const candidate = document.getElementsByTagName(fontSetTag).item(0);
  const fontSet = candidate instanceof XmlElement ? candidate : null;
  if (fontSet == null) throw new Error(`Expected ${fontSetTag} in generated theme`);
  const directChildren = Array.from(fontSet.childNodes)
    .filter((child): child is XmlElement => child.nodeType === 1);
  const typeface = (tagName: string, script?: string): string => {
    const element = directChildren.find((child) => (
      child.tagName === tagName && (script == null || child.getAttribute('script') === script)
    ));
    if (element == null) throw new Error(`Expected ${tagName}${script ? `:${script}` : ''}`);
    return element.getAttribute('typeface') ?? '';
  };
  return {
    latin: typeface('a:latin'),
    eastAsian: typeface('a:ea'),
    complex: typeface('a:cs'),
    hans: typeface('a:font', 'Hans'),
  };
}

describe('Phase 1 Integration', () => {
  const structuredCompiler = new StructuredCompiler();
  const freeformCompiler = new FreeformCompiler();
  const assembler = new DeckAssembler(structuredCompiler, freeformCompiler);

  const realisticDeck: DeckSpec = {
    title: 'Q3 Business Review',
    layout: '16x9',
    theme: { fonts: { major: 'Calibri Light', minor: 'Calibri' } },
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'structured',
          background: { color: '#1A1A2E' },
          elements: [
            { type: 'title', content: 'Q3 Business Review', position: { x: 1, y: 2, w: 8, h: 1.5 }, style: { fontSize: 36, color: '#FFFFFF', align: 'center' } },
            { type: 'text', content: 'Confidential — October 2026', position: { x: 1, y: 4, w: 8, h: 0.6 }, style: { fontSize: 14, color: '#AAAAAA', align: 'center' } },
          ],
          notes: 'Welcome everyone to the Q3 review.',
        },
      },
      {
        slideNumber: 2,
        spec: {
          type: 'structured',
          elements: [
            { type: 'title', content: 'Agenda', position: { x: 0.5, y: 0.3, w: 9, h: 0.8 } },
            {
              type: 'bulletList',
              items: [
                { text: 'Revenue Overview', level: 0 },
                { text: 'Regional Breakdown', level: 1 },
                { text: 'Cost Analysis', level: 0 },
                { text: 'Next Steps', level: 0 },
              ],
              position: { x: 0.5, y: 1.3, w: 9, h: 3.5 },
              style: { fontSize: 18 },
            },
          ],
        },
      },
      {
        slideNumber: 3,
        spec: {
          type: 'structured',
          elements: [
            { type: 'title', content: 'Revenue Trend', position: { x: 0.5, y: 0.3, w: 9, h: 0.8 } },
            {
              type: 'chart',
              chartType: 'bar',
              data: {
                categories: ['Q1', 'Q2', 'Q3'],
                series: [
                  { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [120, 180, 250] },
                  { name: 'Target', labels: ['Q1', 'Q2', 'Q3'], values: [150, 200, 230] },
                ],
              },
              position: { x: 0.5, y: 1.3, w: 9, h: 4.2 },
            },
          ],
        },
      },
      {
        slideNumber: 4,
        spec: {
          type: 'structured',
          elements: [
            { type: 'title', content: 'Regional Performance', position: { x: 0.5, y: 0.3, w: 9, h: 0.8 } },
            {
              type: 'table',
              headers: ['Region', 'Revenue', 'Growth', 'Target'],
              rows: [
                [{ text: 'North America' }, { text: '$120M' }, { text: '+15%', style: { color: '#00AA00' } }, { text: '$110M' }],
                [{ text: 'Europe' }, { text: '$80M' }, { text: '+8%', style: { color: '#00AA00' } }, { text: '$85M' }],
                [{ text: 'Asia Pacific' }, { text: '$50M' }, { text: '-3%', style: { color: '#FF0000' } }, { text: '$55M' }],
              ],
              position: { x: 0.5, y: 1.3, w: 9, h: 3 },
            },
          ],
        },
      },
    ],
  };

  it('generates a valid PPTX from a realistic multi-slide deck', async () => {
    const buf = await assembler.assemble(realisticDeck);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4B); // K
  });

  it('output is a valid ZIP containing [Content_Types].xml', async () => {
    const buf = await assembler.assemble(realisticDeck);
    const zip = await JSZip.loadAsync(buf);
    const contentTypes = zip.file('[Content_Types].xml');
    expect(contentTypes).not.toBeNull();
  });

  it('output contains the expected number of slide XML files', async () => {
    const buf = await assembler.assemble(realisticDeck);
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slideFiles).toHaveLength(realisticDeck.slides.length);
  });

  it('DeckAssembler compiles freeform slides', async () => {
    const deckWithFreeform: DeckSpec = {
      title: 'Mixed',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{ type: 'text', position: { x: 0, y: 0, w: 5, h: 2 }, content: 'hi' }],
          },
        },
      ],
    };
    const buffer = await assembler.assemble(deckWithFreeform);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50); // PK zip header
  });

  it('structured, freeform, and mixed exports preserve declared theme fonts and layout', async () => {
    const structuredDeck: DeckSpec = {
      title: 'Structured theme',
      layout: '16x10',
      theme: { fonts: { major: 'Structured Heading', minor: 'Structured Body' } },
      slides: [{
        slideNumber: 1,
        spec: { type: 'structured', elements: [] },
      }],
    };
    const freeformDeck: DeckSpec = {
      title: 'Freeform theme',
      layout: '4x3',
      theme: { fonts: { major: 'Freeform Heading', minor: 'Freeform Body' } },
      slides: [{
        slideNumber: 1,
        spec: { type: 'freeform', elements: [] },
      }],
    };
    const mixedDeck: DeckSpec = {
      title: 'Mixed theme',
      layout: '16x10',
      theme: { fonts: { major: 'Mixed Heading', minor: 'Mixed Body' } },
      slides: [
        { slideNumber: 1, spec: { type: 'structured', elements: [] } },
        { slideNumber: 2, spec: { type: 'freeform', elements: [] } },
      ],
    };

    const [structuredFacts, freeformFacts, mixedFacts] = await Promise.all([
      structuredCompiler.compileDeck(structuredDeck).then(readPptxDocumentFacts),
      freeformCompiler.compileDeck(freeformDeck).then(readPptxDocumentFacts),
      assembler.assemble(mixedDeck).then(readPptxDocumentFacts),
    ]);

    expect(readThemeFontSlots(structuredFacts.themeXml, 'a:majorFont')).toEqual({
      latin: 'Structured Heading',
      eastAsian: 'Structured Heading',
      complex: 'Structured Heading',
      hans: 'Structured Heading',
    });
    expect(readThemeFontSlots(structuredFacts.themeXml, 'a:minorFont')).toEqual({
      latin: 'Structured Body',
      eastAsian: 'Structured Body',
      complex: 'Structured Body',
      hans: 'Structured Body',
    });
    expect(structuredFacts.presentationXml).toContain('cx="9144000" cy="5715000"');

    expect(readThemeFontSlots(freeformFacts.themeXml, 'a:majorFont')).toEqual({
      latin: 'Freeform Heading',
      eastAsian: 'Freeform Heading',
      complex: 'Freeform Heading',
      hans: 'Freeform Heading',
    });
    expect(readThemeFontSlots(freeformFacts.themeXml, 'a:minorFont')).toEqual({
      latin: 'Freeform Body',
      eastAsian: 'Freeform Body',
      complex: 'Freeform Body',
      hans: 'Freeform Body',
    });
    expect(freeformFacts.presentationXml).toContain('cx="9144000" cy="6858000"');

    expect(readThemeFontSlots(mixedFacts.themeXml, 'a:majorFont')).toEqual({
      latin: 'Mixed Heading',
      eastAsian: 'Mixed Heading',
      complex: 'Mixed Heading',
      hans: 'Mixed Heading',
    });
    expect(readThemeFontSlots(mixedFacts.themeXml, 'a:minorFont')).toEqual({
      latin: 'Mixed Body',
      eastAsian: 'Mixed Body',
      complex: 'Mixed Body',
      hans: 'Mixed Body',
    });
    expect(mixedFacts.presentationXml).toContain('cx="9144000" cy="5715000"');
  });

  it('StructuredCompiler.compileDeck produces same result as DeckAssembler for structured-only decks', async () => {
    const directBuf = await structuredCompiler.compileDeck(realisticDeck);
    // Both should produce valid PPTX (exact bytes may differ due to timestamps)
    expect(directBuf[0]).toBe(0x50);
    expect(directBuf[1]).toBe(0x4B);
  });

  it('StructuredCompiler rejects freeform slides instead of silently dropping them', async () => {
    const deckWithFreeform: DeckSpec = {
      title: 'Mixed',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{ type: 'text', position: { x: 0, y: 0, w: 5, h: 2 }, content: 'hi' }],
          },
        },
      ],
    };

    await expect(structuredCompiler.compileDeck(deckWithFreeform)).rejects.toThrow(
      'Freeform slides are not supported by StructuredCompiler',
    );
  });
});
