/**
 * Multi-round Patch Regression Test
 *
 * 验证 3-5 轮连续 patch 链的稳定性：
 * generate → patch(text) → patch(style) → patch(insert) → patch(delete)
 */

import { describe, expect, it } from 'vitest';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';import { PptxValidator } from '../engine/pptx/PptxValidator.js';import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder.js';
import type { DeckSpec, PatchSpec, StructuredSlideSpec } from '@plugin/slides/shared';

const structuredCompiler = new StructuredCompiler();
const patchCompiler = new PatchCompiler(structuredCompiler);
const reader = new PptxReader();
const validator = new PptxValidator();
const canonicalBuilder = new CanonicalBuilder();

function makeSlide(title: string, body?: string): StructuredSlideSpec {
  return {
    type: 'structured',
    elements: [
      { type: 'title', content: title, position: { x: 1, y: 1, w: 8, h: 1 } },
      { type: 'text', content: body ?? `Body of ${title}`, position: { x: 1, y: 2.5, w: 8, h: 1 } },
    ],
  };
}

function makeDeck(titles: string[]): DeckSpec {
  return {
    title: 'Multi-round Test',
    layout: '16x9',
    slides: titles.map((t, i) => ({ slideNumber: i + 1, spec: makeSlide(t) })),
  };
}

async function validateBuffer(buffer: Buffer): Promise<void> {
  const v = await validator.validate(buffer);
  expect(v.errors, `Validation errors: ${v.errors.join('; ')}`).toEqual([]);
  expect(v.valid).toBe(true);
}

/** 获取指定 slide 上第一个 text 元素的 name（用于 patch target） */
async function getFirstElementName(buffer: Buffer, slideNumber: number): Promise<string> {
  const info = await reader.parse(buffer);
  const slide = info.slides[slideNumber - 1];
  if (!slide || slide.elements.length === 0) throw new Error(`No elements on slide ${slideNumber}`);
  return slide.elements[0].name;
}

describe('Multi-round patch regression', () => {
  it('5-round patch chain on generated deck', async () => {
    // Round 0: Generate
    let buffer = await structuredCompiler.compileDeck(makeDeck(['Slide 1', 'Slide 2', 'Slide 3']));
    await validateBuffer(buffer);
    let info = await reader.parse(buffer);
    expect(info.slideCount).toBe(3);

    // Round 1: Modify text (discover actual element name first)
    let elName = await getFirstElementName(buffer, 1);
    const patch1: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'modify_text', target: { slideNumber: 1, elementName: elName }, text: 'Updated Title' },
      ],
    };
    buffer = await patchCompiler.compile(buffer, patch1);
    await validateBuffer(buffer);
    info = await reader.parse(buffer);
    expect(info.slideCount).toBe(3);

    // Round 2: Modify style (fill) — discover name after rebuild
    elName = await getFirstElementName(buffer, 2);
    const patch2: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'modify_style', target: { slideNumber: 2, elementName: elName }, style: { fill: '#FF0000' } },
      ],
    };
    buffer = await patchCompiler.compile(buffer, patch2);
    await validateBuffer(buffer);

    // Round 3: Insert slide
    const patch3: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'insert_slide', slideNumber: 2, spec: makeSlide('Inserted Slide') },
      ],
    };
    buffer = await patchCompiler.compile(buffer, patch3);
    await validateBuffer(buffer);
    info = await reader.parse(buffer);
    expect(info.slideCount).toBe(4);

    // Round 4: Delete slide
    const patch4: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'delete_slide', slideNumber: 3 }],
    };
    buffer = await patchCompiler.compile(buffer, patch4);
    await validateBuffer(buffer);
    info = await reader.parse(buffer);
    expect(info.slideCount).toBe(3);

    // Round 5: Another text modify on the patched deck
    elName = await getFirstElementName(buffer, 1);
    const patch5: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'modify_text', target: { slideNumber: 1, elementName: elName }, text: 'Final Title' },
      ],
    };
    buffer = await patchCompiler.compile(buffer, patch5);
    await validateBuffer(buffer);
    info = await reader.parse(buffer);
    expect(info.slideCount).toBe(3);
  }, 30_000);

  it('style patch chain: fill → border → shadow', async () => {
    let buffer = await structuredCompiler.compileDeck(makeDeck(['Style Test']));
    await validateBuffer(buffer);

    // fill (on fresh generated PPTX, element names are stable)
    let elName = await getFirstElementName(buffer, 1);
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 1, elementName: elName }, style: { fill: '#0000FF' } }],
    });
    await validateBuffer(buffer);

    // border (re-discover name after style patch — style patches don't rebuild via automizer)
    elName = await getFirstElementName(buffer, 1);
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 1, elementName: elName }, style: { border: { color: '#FF0000', width: 2 } } }],
    });
    await validateBuffer(buffer);

    // shadow
    elName = await getFirstElementName(buffer, 1);
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 1, elementName: elName }, style: { shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2, opacity: 0.3 } } }],
    });
    await validateBuffer(buffer);
  });

  it('elementId stability across style-only patch rounds', async () => {
    let buffer = await structuredCompiler.compileDeck(makeDeck(['Stable ID Test', 'Page 2']));

    // Inspect before patch
    const infoBefore = await reader.parse(buffer);
    canonicalBuilder.enrichElementIds(infoBefore);
    const idsBefore = infoBefore.slides[0].elements.map((e) => e.elementId);

    // Style patch on slide 1 (style patches don't rebuild via automizer, so names stay)
    const elName = await getFirstElementName(buffer, 1);
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 1, elementName: elName }, style: { fill: '#FF0000' } }],
    });

    const infoAfter = await reader.parse(buffer);
    canonicalBuilder.enrichElementIds(infoAfter);
    const idsAfter = infoAfter.slides[0].elements.map((e) => e.elementId);

    // Slide 1 elementIds should be stable after style-only patch
    expect(idsAfter).toEqual(idsBefore);
  });

  it('empty patch (0 operations) is a no-op', async () => {
    const buffer = await structuredCompiler.compileDeck(makeDeck(['No-op']));
    const patched = await patchCompiler.compile(buffer, { type: 'patch', operations: [] });
    await validateBuffer(patched);
    const info = await reader.parse(patched);
    expect(info.slideCount).toBe(1);
  });

  it('patched deck can be further patched (insert → delete)', async () => {
    // generated
    let buffer = await structuredCompiler.compileDeck(makeDeck(['Gen 1', 'Gen 2']));

    // patched (insert)
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'insert_slide', slideNumber: 3, spec: makeSlide('Inserted') }],
    });
    let info = await reader.parse(buffer);
    expect(info.slideCount).toBe(3);

    // patched again (delete)
    buffer = await patchCompiler.compile(buffer, {
      type: 'patch',
      operations: [{ op: 'delete_slide', slideNumber: 1 }],
    });
    await validateBuffer(buffer);
    info = await reader.parse(buffer);
    expect(info.slideCount).toBe(2);
  });
});
