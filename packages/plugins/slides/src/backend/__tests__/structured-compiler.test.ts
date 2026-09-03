import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { DeckSpec, StructuredSlideSpec } from '@plugin/slides/shared';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import { PptxValidator } from '../engine/pptx/PptxValidator.js';
import { PptxReader } from '../engine/parser/PptxReader.js';

function makeDeck(slides: StructuredSlideSpec[], overrides?: Partial<DeckSpec>): DeckSpec {
  return {
    title: 'Test Deck',
    slides: slides.map((spec, i) => ({ slideNumber: i + 1, spec })),
    ...overrides,
  };
}

function structured(elements: StructuredSlideSpec['elements'], extra?: Partial<StructuredSlideSpec>): StructuredSlideSpec {
  return { type: 'structured', elements, ...extra };
}

const box = { x: 0.5, y: 0.5, w: 9, h: 1 };

async function readSlideXml(buffer: Buffer, slideNumber = 1): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntry = zip.file(`ppt/slides/slide${slideNumber}.xml`);
  if (slideEntry == null) {
    throw new Error(`Expected slide XML entry for slide ${slideNumber}`);
  }
  return slideEntry.async('text');
}

describe('StructuredCompiler', () => {
  const compiler = new StructuredCompiler();
  const validator = new PptxValidator();

  it('writes explicit multiple/exact/default line spacing at paragraph level', async () => {
    const deck = makeDeck([structured([
      {
        type: 'text',
        content: 'Multiple',
        position: { x: 0.5, y: 0.5, w: 3, h: 0.5 },
        style: { fontSize: 12, lineSpacing: { kind: 'multiple', value: 1.18 } },
      },
      {
        type: 'text',
        content: 'Exact',
        position: { x: 0.5, y: 1.1, w: 3, h: 0.5 },
        style: { fontSize: 12, lineSpacing: { kind: 'exactPt', value: 18 } },
      },
      {
        type: 'text',
        content: 'Default',
        position: { x: 0.5, y: 1.7, w: 3, h: 0.5 },
      },
    ])]);

    const xml = await readSlideXml(await compiler.compileDeck(deck));

    expect(xml).toContain('<a:spcPct val="118000"/>');
    expect(xml).toContain('<a:spcPts val="1800"/>');
    expect(xml).toContain('<a:spcPct val="100000"/>');
  });

  // ─── 基础 ─────────────────────────────────────────────────────────────

  it('produces a valid PPTX buffer (ZIP magic bytes)', async () => {
    const deck = makeDeck([structured([{ type: 'title', content: 'Hello', position: box }])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP 文件以 PK (0x50 0x4B) 开头
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
  });

  it('handles an empty slide list', async () => {
    const deck = makeDeck([]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  // ─── Layout ───────────────────────────────────────────────────────────

  it.each(['16x9', '16x10', '4x3'] as const)('supports layout %s', async (layout) => {
    const deck = makeDeck(
      [structured([{ type: 'text', content: 'x', position: box }])],
      { layout },
    );
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('writes and reads back an exact custom slide size', async () => {
    const deck = makeDeck(
      [structured([{ type: 'text', content: 'Vertical', position: box }])],
      { layout: { width: 5.625, height: 10, unit: 'in' } },
    );
    const buf = await compiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buf);
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
    const parsed = await new PptxReader().parse(buf);

    expect(presentationXml).toContain('<p:sldSz cx="5143500" cy="9144000"');
    expect(parsed.slideSize).toEqual({ width: 5.625, height: 10 });
  });

  // ─── 元素类型 ─────────────────────────────────────────────────────────

  it('compiles title element', async () => {
    const deck = makeDeck([structured([
      { type: 'title', content: 'Main Title', position: box, style: { fontSize: 32, bold: true, color: '#FF0000' } },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles text element', async () => {
    const deck = makeDeck([structured([
      { type: 'text', content: 'Body text here', position: box, style: { fontSize: 14, fontFamily: 'Arial' } },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('writes text layout fit, wrap, and margins through the structured compiler', async () => {
    const deck = makeDeck([structured([
      { type: 'text', content: 'Body text here', position: box },
    ])]);
    const buf = await compiler.compileDeck(deck);
    const slideXml = await readSlideXml(buf);

    expect(slideXml).toContain(
      '<a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720"',
    );
    expect(slideXml).toContain('<a:spAutoFit/>');
  });

  it('writes intrinsic-width text as an unwrapped PowerPoint text box', async () => {
    const deck = makeDeck([structured([{
      type: 'text',
      content: '01',
      position: { x: 8.8, y: 0.3, w: 0.37, h: 0.24 },
      textWrap: 'none',
    }])]);

    const slideXml = await readSlideXml(await compiler.compileDeck(deck));

    expect(slideXml).toContain('<a:bodyPr wrap="none"');
    expect(slideXml).toContain('<a:spAutoFit/>');
  });

  it('compiles bulletList with nested levels', async () => {
    const deck = makeDeck([structured([
      {
        type: 'bulletList',
        items: [
          { text: 'Item 1', level: 0 },
          { text: 'Sub-item', level: 1 },
          { text: 'Item 2', level: 0 },
        ],
        position: { x: 0.5, y: 1, w: 9, h: 4 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles numberedList', async () => {
    const deck = makeDeck([structured([
      {
        type: 'numberedList',
        items: [{ text: 'First' }, { text: 'Second' }],
        position: box,
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles chart (bar) with multiple series', async () => {
    const deck = makeDeck([structured([
      {
        type: 'chart',
        chartType: 'bar',
        data: {
          categories: ['Q1', 'Q2', 'Q3'],
          series: [
            { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [100, 200, 300] },
            { name: 'Cost', labels: ['Q1', 'Q2', 'Q3'], values: [80, 150, 220] },
          ],
        },
        position: { x: 0.5, y: 1.5, w: 9, h: 4 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles chart (pie)', async () => {
    const deck = makeDeck([structured([
      {
        type: 'chart',
        chartType: 'pie',
        data: {
          categories: ['A', 'B', 'C'],
          series: [{ name: 'Share', labels: ['A', 'B', 'C'], values: [40, 35, 25] }],
        },
        position: { x: 1, y: 1, w: 8, h: 5 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('uses deck theme chart accents when exporting native chart colors', async () => {
    const deck = makeDeck([structured([
      {
        type: 'chart',
        chartType: 'bar',
        data: {
          categories: ['Q1', 'Q2'],
          series: [
            { name: 'Revenue', labels: ['Q1', 'Q2'], values: [10, 20] },
            { name: 'EBITDA', labels: ['Q1', 'Q2'], values: [3, 5] },
          ],
        },
        position: { x: 0.5, y: 1.5, w: 9, h: 4 },
      },
    ])], {
      theme: {
        colors: {
          accent1: '#1122EE',
          accent2: '#CC3333',
        },
      },
    });

    const buf = await compiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buf);
    const chartEntryName = Object.keys(zip.files).find((name) => name.startsWith('ppt/charts/chart') && name.endsWith('.xml'));

    if (!chartEntryName) {
      throw new Error('Expected exported PPTX to contain a chart XML entry');
    }
    const chartEntry = zip.file(chartEntryName);
    if (!chartEntry) {
      throw new Error(`Chart XML entry not found: ${chartEntryName}`);
    }
    const chartXml = await chartEntry.async('text');

    expect(chartXml).toContain('<a:srgbClr val="CC3333"/>');
    expect(chartXml).toContain('<a:srgbClr val="1122EE"/>');
  });

  it('prefers explicit theme chart palette when exporting native chart colors', async () => {
    const deck = makeDeck([structured([
      {
        type: 'chart',
        chartType: 'bar',
        data: {
          categories: ['Q1', 'Q2'],
          series: [
            { name: 'Revenue', labels: ['Q1', 'Q2'], values: [10, 20] },
            { name: 'EBITDA', labels: ['Q1', 'Q2'], values: [3, 5] },
          ],
        },
        position: { x: 0.5, y: 1.5, w: 9, h: 4 },
      },
    ])], {
      theme: {
        colors: {
          accent1: '#1122EE',
          accent2: '#CC3333',
        },
        chart: {
          palette: ['#101010', '#202020', '#303030'],
        },
      },
    });

    const buf = await compiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buf);
    const chartEntryName = Object.keys(zip.files).find((name) => name.startsWith('ppt/charts/chart') && name.endsWith('.xml'));

    if (!chartEntryName) {
      throw new Error('Expected exported PPTX to contain a chart XML entry');
    }
    const chartEntry = zip.file(chartEntryName);
    if (!chartEntry) {
      throw new Error(`Chart XML entry not found: ${chartEntryName}`);
    }
    const chartXml = await chartEntry.async('text');

    expect(chartXml).toContain('<a:srgbClr val="101010"/>');
    expect(chartXml).toContain('<a:srgbClr val="202020"/>');
    expect(chartXml).not.toContain('<a:srgbClr val="CC3333"/>');
  });

  it('compiles table with headers', async () => {
    const deck = makeDeck([structured([
      {
        type: 'table',
        headers: ['Name', 'Value'],
        rows: [
          [{ text: 'Alpha' }, { text: '100', fill: '#E0FFE0' }],
          [{ text: 'Beta' }, { text: '200' }],
        ],
        position: { x: 0.5, y: 1, w: 9, h: 3 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('sanitizes duplicate object ids when a slide mixes text and native table', async () => {
    const deck = makeDeck([structured([
      { type: 'text', content: 'Board Discussion Material', position: { x: 0.7, y: 0.7, w: 8, h: 0.25 } },
      { type: 'title', content: 'Where value pools concentrate', position: { x: 0.7, y: 1.0, w: 8, h: 0.45 } },
      { type: 'text', content: 'China market expansion and operating model reset', position: { x: 0.7, y: 1.5, w: 8, h: 0.3 } },
      {
        type: 'table',
        headers: ['Layer', '2026E value pool', 'Growth', 'Implication'],
        rows: [
          [{ text: 'Applications' }, { text: '$6.8B' }, { text: '+28%' }, { text: 'Own vertical use cases' }],
          [{ text: 'Data & workflow' }, { text: '$4.2B' }, { text: '+24%' }, { text: 'Differentiate via orchestration' }],
          [{ text: 'Industrial foundation models' }, { text: '$3.1B' }, { text: '+35%' }, { text: 'Partner, do not build from scratch' }],
          [{ text: 'Integration services' }, { text: '$5.5B' }, { text: '+18%' }, { text: 'Build repeatable deployment playbooks' }],
        ],
        position: { x: 0.7, y: 2.2, w: 6.6, h: 1.85 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    const result = await validator.validate(buf);

    expect(result.valid).toBe(true);
    expect(result.structure.duplicateObjectIds).toEqual([]);
  });

  it('compiles table with colspan/rowspan', async () => {
    const deck = makeDeck([structured([
      {
        type: 'table',
        rows: [
          [{ text: 'Merged', colspan: 2 }, { text: 'C' }],
          [{ text: 'A' }, { text: 'B' }, { text: 'D' }],
        ],
        position: { x: 0.5, y: 1, w: 9, h: 3 },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles image from data URI', async () => {
    // 1x1 transparent PNG as data URI
    const pngDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const deck = makeDeck([structured([
      { type: 'image', src: pngDataUri, position: { x: 1, y: 1, w: 3, h: 3 }, alt: 'tiny' },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles image from source-ref object', async () => {
    const deck = makeDeck([structured([
      {
        type: 'image',
        src: { kind: 'data_uri', dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
        position: { x: 1, y: 1, w: 3, h: 3 },
        alt: 'tiny',
        fitMode: 'cover',
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles shape with style', async () => {
    const deck = makeDeck([structured([
      {
        type: 'shape',
        geometry: 'rect',
        position: { x: 1, y: 1, w: 4, h: 3 },
        style: {
          fill: '#4472C4',
          border: { color: '#333333', width: 2, dash: 'solid' },
          borderRadius: 0.1,
          rotate: 15,
        },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('exports shape fill gradients as native OOXML gradFill for explicitly marked shapes', async () => {
    const deck = makeDeck([structured([
      {
        type: 'shape',
        geometry: 'rect',
        position: { x: 1, y: 1, w: 4, h: 1.2 },
        style: {
          gradient: {
            type: 'linear',
            angle: 90,
            stops: [
              { color: '#102030', position: 0 },
              { color: '#F97316', position: 1 },
            ],
          },
        },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('<a:gradFill rotWithShape="1">');
    expect(slideXml).toContain('<a:srgbClr val="102030"/>');
    expect(slideXml).toContain('<a:srgbClr val="F97316"/>');
  });

  describe('preset geometry 输出原生 OOXML preset', () => {
    const cases = [
      ['ellipse', 'ellipse'],
      ['rect', 'rect'],
      ['star5', 'star5'],
      ['rightArrow', 'rightArrow'],
      ['callout', 'wedgeRectCallout'],
      ['diamond', 'diamond'],
      ['roundRect', 'roundRect'],
      ['rightTriangle', 'rtTriangle'],
      ['nonIsoscelesTrapezoid', 'nonIsoscelesTrapezoid'],
    ] as const;

    it.each(cases)('geometry "%s" 输出 prst="%s"', async (geometry, expectedPrst) => {
      const deck = makeDeck([structured([
        {
          type: 'shape',
          geometry,
          position: { x: 1, y: 1, w: 2, h: 2 },
          style: { fill: '#4472C4' },
        },
      ])]);
      const buf = await compiler.compileDeck(deck);
      const zip = await JSZip.loadAsync(buf);
      const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
      // PptxGenJS 把 SHAPE_NAME 写成 OOXML 的 a:prstGeom@prst
      expect(slideXml).toContain(`prst="${expectedPrst}"`);
    });
  });

  it('compiles shape with text overlay', async () => {
    const deck = makeDeck([structured([
      {
        type: 'shape',
        geometry: 'ellipse',
        position: { x: 2, y: 2, w: 3, h: 3 },
        text: 'Inside shape',
        style: { fill: '#FF6B6B' },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles multiline shape text with rotation and transparency', async () => {
    const deck = makeDeck([structured([
      {
        type: 'shape',
        geometry: 'rect',
        position: { x: 1, y: 1, w: 2.4, h: 1.1 },
        text: 'Axis label\nSecondary line',
        style: { fill: '#FFFFFF', opacity: 0, rotate: -90 },
      },
      {
        type: 'shape',
        geometry: 'rect',
        position: { x: 4, y: 1, w: 3.2, h: 2 },
        text: 'Invest now\nCommercial engine\nBlueprint factory',
        style: { fill: '#EEF4FB' },
      },
    ])]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  // ─── 背景 & 备注 ─────────────────────────────────────────────────────

  it('applies background color', async () => {
    const deck = makeDeck([structured(
      [{ type: 'text', content: 'On colored bg', position: box }],
      { background: { color: '#1A1A2E' } },
    )]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('compiles gradient background through shared renderer', async () => {
    const deck = makeDeck([structured(
      [{ type: 'text', content: 'On gradient bg', position: box }],
      {
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
      },
    )]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('applies speaker notes', async () => {
    const deck = makeDeck([structured(
      [{ type: 'text', content: 'Slide with notes', position: box }],
      { notes: 'Remember to mention the quarterly results' },
    )]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  // ─── 主题 ─────────────────────────────────────────────────────────────

  it('applies theme fonts', async () => {
    const deck = makeDeck(
      [structured([{ type: 'text', content: 'Themed', position: box }])],
      { theme: { fonts: { major: 'Georgia', minor: 'Verdana' } } },
    );
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });

  // ─── 多页 ─────────────────────────────────────────────────────────────

  it('compiles a multi-slide deck', async () => {
    const deck = makeDeck([
      structured([{ type: 'title', content: 'Cover', position: box }]),
      structured([
        { type: 'text', content: 'Agenda', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
        {
          type: 'bulletList',
          items: [{ text: 'Topic A' }, { text: 'Topic B' }],
          position: { x: 0.5, y: 1.5, w: 9, h: 3 },
        },
      ]),
      structured([
        {
          type: 'chart',
          chartType: 'line',
          data: {
            categories: ['Jan', 'Feb', 'Mar'],
            series: [{ name: 'Trend', labels: ['Jan', 'Feb', 'Mar'], values: [10, 20, 15] }],
          },
          position: { x: 0.5, y: 1, w: 9, h: 5 },
        },
      ]),
    ]);
    const buf = await compiler.compileDeck(deck);
    expect(buf.length).toBeGreaterThan(0);
  });
});
