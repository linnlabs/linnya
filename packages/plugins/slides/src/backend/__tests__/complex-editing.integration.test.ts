import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';import { DeckAssembler } from '../engine/DeckAssembler.js';import { FreeformCompiler } from '../engine/FreeformCompiler.js';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';import { PptxValidator } from '../engine/pptx/PptxValidator.js';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder.js';import { normalizeInspectSnapshot, serializeSnapshot } from '../engine/parser/InspectSnapshot.js';
import type { DeckSpec, PatchSpec } from '@plugin/slides/shared';

const FIXTURES_DIR = join(__dirname, 'fixtures');

const structuredCompiler = new StructuredCompiler();
const freeformCompiler = new FreeformCompiler();
const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
const patchCompiler = new PatchCompiler(structuredCompiler);
const reader = new PptxReader();
const validator = new PptxValidator();
const canonicalBuilder = new CanonicalBuilder();

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

function makeComplexFreeformDeck(): DeckSpec {
  return {
    title: 'Complex Editing Deck',
    layout: '16x9',
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'freeform',
          background: { color: '#0B1220' },
          elements: [
            {
              type: 'group',
              position: { x: 0.8, y: 0.8, w: 8.4, h: 3 },
              children: [
                {
                  type: 'shape',
                  geometry: 'roundRect',
                  position: { x: 0, y: 0, w: 8, h: 3 },
                  style: { fill: '#172554' },
                },
                {
                  type: 'text',
                  position: { x: 0.45, y: 0.35, w: 4.2, h: 0.7 },
                  content: 'Executive Summary',
                  style: { fontSize: 26, color: '#FFFFFF', bold: true },
                },
                {
                  type: 'group',
                  position: { x: 5.4, y: 0.5, w: 2, h: 1.4 },
                  children: [
                    {
                      type: 'shape',
                      geometry: 'ellipse',
                      position: { x: 0, y: 0, w: 2, h: 1.2 },
                      style: { fill: '#06B6D4' },
                    },
                    {
                      type: 'text',
                      position: { x: 0.4, y: 0.35, w: 1.2, h: 0.4 },
                      content: '88%',
                      style: { fontSize: 22, color: '#FFFFFF', bold: true, align: 'center' },
                    },
                  ],
                },
                {
                  type: 'shape',
                  geometry: 'rect',
                  position: { x: 0.55, y: 2.15, w: 2.3, h: 0.48 },
                  style: { fill: '#F97316', rotate: -6 },
                  content: 'Active rollout',
                },
              ],
            },
            {
              type: 'text',
              position: { x: 0.9, y: 4.25, w: 5.2, h: 0.45 },
              content: 'Complex footer annotation',
              style: { fontSize: 12, color: '#94A3B8' },
            },
          ],
        },
      },
    ],
  };
}

async function expectValid(buffer: Buffer): Promise<void> {
  const result = await validator.validate(buffer);
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
}

describe('Complex PPT editing regression', () => {
  it('round-trips a complex freeform scene with stable snapshot and unique elementIds', async () => {
    const deck = makeComplexFreeformDeck();

    const bufferA = await deckAssembler.assemble(deck);
    const bufferB = await deckAssembler.assemble(deck);
    await expectValid(bufferA);
    await expectValid(bufferB);

    const infoA = await reader.parse(bufferA);
    const infoB = await reader.parse(bufferB);
    expect(infoA.slideCount).toBe(1);

    const title = infoA.slides[0].elements.find((element) => element.text === 'Executive Summary');
    const footer = infoA.slides[0].elements.find((element) => element.text === 'Complex footer annotation');
    const badge = infoA.slides[0].elements.find((element) => element.text === '88%');

    expect(title?.position).toMatchObject({ x: 1.273, y: 1.15 });
    expect(footer?.position).toMatchObject({ x: 0.9, y: 4.25 });
    expect(badge?.position?.x).toBeGreaterThan(6);

    canonicalBuilder.enrichElementIds(infoA);
    const ids = infoA.slides[0].elements.map((element) => element.elementId);
    expect(new Set(ids).size).toBe(ids.length);

    const snapA = serializeSnapshot(normalizeInspectSnapshot(infoA));
    const snapB = serializeSnapshot(normalizeInspectSnapshot(infoB));
    expect(snapA).toBe(snapB);
  });

  it('patches imported themed content across multiple rounds without corruption', async () => {
    let buffer = loadFixture('themed.pptx');
    await expectValid(buffer);

    const patchSequence: PatchSpec[] = [
      {
        type: 'patch',
        operations: [
          {
            op: 'modify_text',
            target: { slideNumber: 1, elementName: 'Text 1' },
            text: 'Imported Deck Patched',
          },
        ],
      },
      {
        type: 'patch',
        operations: [
          {
            op: 'modify_style',
            target: { slideNumber: 1, elementName: 'Shape 0' },
            style: { fill: '#2563EB', rotate: 8 },
          },
        ],
      },
    ];

    for (const patch of patchSequence) {
      buffer = await patchCompiler.compile(buffer, patch);
      await expectValid(buffer);
    }

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
    expect(info.slides[0].elements.some((element) => element.text === 'Imported Deck Patched')).toBe(true);
  });

  it('inserts a structured slide into an imported themed PPT and keeps both slides inspectable', async () => {
    let buffer = loadFixture('themed.pptx');
    await expectValid(buffer);

    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [
        {
          op: 'insert_slide',
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Inserted Summary', position: { x: 1, y: 1, w: 8, h: 1 } },
              { type: 'text', content: 'Inserted after imported slide', position: { x: 1, y: 2.2, w: 8, h: 0.8 } },
            ],
          },
        },
      ],
    });
    await expectValid(buffer);

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(2);
    expect(info.slides[0].elements.some((element) => element.text === 'Themed Fixture')).toBe(true);
    expect(info.slides[1].elements.some((element) => element.text === 'Inserted Summary')).toBe(true);
  });

  it('updates chart data in an imported chart fixture and remains inspectable after repeated edits', async () => {
    let buffer = loadFixture('with-chart.pptx');
    await expectValid(buffer);

    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [
        {
          op: 'update_chart',
          target: { slideNumber: 1, elementName: 'Chart 0' },
          data: {
            categories: ['Q1', 'Q2', 'Q3'],
            series: [
              { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [35, 48, 67] },
            ],
          },
        },
      ],
    });
    await expectValid(buffer);

    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [
        {
          op: 'modify_text',
          target: { slideNumber: 1, elementName: 'Text 0' },
          text: 'Chart Fixture Patched',
        },
      ],
    });
    await expectValid(buffer);

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
    expect(info.slides[0].elements.some((element) => element.text === 'Chart Fixture Patched')).toBe(true);
    expect(info.slides[0].elements.some((element) => element.type === 'chart')).toBe(true);
  });
});
