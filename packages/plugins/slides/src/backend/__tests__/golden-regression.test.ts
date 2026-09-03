/**
 * Golden Regression Test
 *
 * 批量跑所有 golden fixtures 的 generate → validate → inspect → patch 链路。
 */

import { describe, expect, it } from 'vitest';
import { GOLDEN_FIXTURES } from './fixtures/golden-regression/index.js';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';import { PptxValidator } from '../engine/pptx/PptxValidator.js';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';import { FreeformCompiler } from '../engine/FreeformCompiler.js';import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder.js';import { PreviewMapper } from '../engine/parser/PreviewMapper.js';import { DeckAssembler } from '../engine/DeckAssembler.js';import { normalizeInspectSnapshot, serializeSnapshot } from '../engine/parser/InspectSnapshot.js';

const structuredCompiler = new StructuredCompiler();
const freeformCompiler = new FreeformCompiler();
const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
const pptxReader = new PptxReader();
const pptxValidator = new PptxValidator();
const patchCompiler = new PatchCompiler(structuredCompiler);
const canonicalBuilder = new CanonicalBuilder();
const previewMapper = new PreviewMapper();

/** 根据 deck 是否含 freeform 选择编译方式 */
async function compileDeck(fixture: { deckSpec: import('../domain/SlideSpec.js').DeckSpec }): Promise<Buffer> {
  const hasFreeform = fixture.deckSpec.slides.some((s) => s.spec.type === 'freeform');
  return hasFreeform
    ? deckAssembler.assemble(fixture.deckSpec)
    : structuredCompiler.compileDeck(fixture.deckSpec);
}

describe('Golden fixture regression', () => {
  it.each(
    GOLDEN_FIXTURES.map((f) => [f.id, f] as const),
  )('%s — generate + validate + inspect', async (_id, fixture) => {
    // 1. Generate
    const buffer = await compileDeck(fixture);
    expect(buffer.length).toBeGreaterThan(0);

    // 2. Validate PPTX structure
    const validation = await pptxValidator.validate(buffer);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    // 3. Inspect
    const info = await pptxReader.parse(buffer);
    expect(info.slideCount).toBe(fixture.expectations.slideCount);

    // 4. Check expected element types exist
    const allTypes = new Set(
      info.slides.flatMap((s) => s.elements.map((e) => e.type)),
    );
    for (const expectedType of fixture.expectations.elementTypes) {
      // map DSL element types to PresentationInfo types
      const mapped = mapElementType(expectedType);
      expect(allTypes, `missing element type: ${expectedType} (mapped: ${mapped})`).toContain(mapped);
    }

    // 5. Theme check
    if (fixture.expectations.hasTheme) {
      expect(Object.keys(info.theme.colors).length).toBeGreaterThan(0);
    }

    // 6. Snapshot stability — generate twice, inspect results should match
    const buffer2 = await compileDeck(fixture);
    const info2 = await pptxReader.parse(buffer2);
    const snap1 = serializeSnapshot(normalizeInspectSnapshot(info));
    const snap2 = serializeSnapshot(normalizeInspectSnapshot(info2));
    expect(snap1).toBe(snap2);
  });

  // Patch chain tests for fixtures that define patchSpecs
  const fixturesWithPatches = GOLDEN_FIXTURES.filter((f) => f.patchSpecs && f.patchSpecs.length > 0);

  if (fixturesWithPatches.length > 0) {
    it.each(
      fixturesWithPatches.map((f) => [f.id, f] as const),
    )('%s — patch chain', async (_id, fixture) => {
      let buffer = await compileDeck(fixture);

      for (const patchSpec of fixture.patchSpecs!) {
        buffer = await patchCompiler.compile(buffer, patchSpec);

        // Validate after each patch
        const validation = await pptxValidator.validate(buffer);
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);

        // Inspect should not throw
        const info = await pptxReader.parse(buffer);
        expect(info.slideCount).toBeGreaterThan(0);
      }
    });
  }

  // Round-trip: generate → export buffer → re-parse
  it.each(
    GOLDEN_FIXTURES.map((f) => [f.id, f] as const),
  )('%s — round-trip re-parse', async (_id, fixture) => {
    const buffer = await compileDeck(fixture);
    // Re-parse the generated buffer
    const info = await pptxReader.parse(buffer);
    expect(info.slideCount).toBe(fixture.expectations.slideCount);
    expect(info.slides).toHaveLength(fixture.expectations.slideCount);
  });
  // Preview chain: generate → inspect → canonical → preview
  it.each(
    GOLDEN_FIXTURES.map((f) => [f.id, f] as const),
  )('%s — preview chain', async (_id, fixture) => {
    const buffer = await compileDeck(fixture);
    const info = await pptxReader.parse(buffer);

    // Build canonical
    const canonical = canonicalBuilder.build('test-node', 1, fixture.deckSpec.title, info);
    expect(canonical.slides).toHaveLength(fixture.expectations.slideCount);

    // All elements should have elementId
    for (const slide of canonical.slides) {
      for (const el of slide.elements) {
        expect(el.elementId).toBeTruthy();
      }
    }

    // Map to preview
    const preview = previewMapper.toPreview(canonical);
    expect(preview.nodeId).toBe('test-node');
    expect(preview.slides).toHaveLength(fixture.expectations.slideCount);
    expect(preview.theme.fonts.major).toBeTruthy();

    // elementIds in preview should match canonical
    for (let i = 0; i < canonical.slides.length; i++) {
      const cSlide = canonical.slides[i];
      const pSlide = preview.slides[i];
      expect(pSlide.slideId).toBe(cSlide.slideId);
      expect(pSlide.elements.map((e) => e.elementId))
        .toEqual(cSlide.elements.map((e) => e.elementId));
    }
  });
});

/** Map DSL element type names to PresentationInfo element types */
function mapElementType(dslType: string): string {
  switch (dslType) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return 'text';
    case 'chart':
    case 'table':
    case 'image':
    case 'shape':
      return dslType;
    default:
      return dslType;
  }
}
