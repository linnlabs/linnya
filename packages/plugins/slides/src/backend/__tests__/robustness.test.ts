/**
 * Robustness Tests
 *
 * 大 deck、边界 case、特殊字符、错误恢复
 */

import { describe, expect, it } from 'vitest';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';import { PptxValidator } from '../engine/pptx/PptxValidator.js';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';
import type { DeckSpec, PatchSpec, StructuredSlideSpec } from '@plugin/slides/shared';

const compiler = new StructuredCompiler();
const reader = new PptxReader();
const validator = new PptxValidator();
const patchCompiler = new PatchCompiler(compiler);

function makeSlide(title: string): StructuredSlideSpec {
  return {
    type: 'structured',
    elements: [
      { type: 'title', content: title, position: { x: 1, y: 1, w: 8, h: 1 } },
      { type: 'text', content: `Body of ${title}`, position: { x: 1, y: 2.5, w: 8, h: 1 } },
    ],
  };
}

function makeLargeDeck(count: number): DeckSpec {
  return {
    title: `Large Deck (${count} slides)`,
    layout: '16x9',
    slides: Array.from({ length: count }, (_, i) => ({
      slideNumber: i + 1,
      spec: makeSlide(`Slide ${i + 1}`),
    })),
  };
}

describe('Robustness', () => {
  describe('large decks', () => {
    it('generates and validates a 50-page deck', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(50));
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
      expect(v.structure.slideCount).toBe(50);

      const info = await reader.parse(buffer);
      expect(info.slideCount).toBe(50);
    }, 30000);

    it('generates and validates a 100-page deck', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(100));
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
      expect(v.structure.slideCount).toBe(100);
    }, 60000);

    it('patches a 50-page deck (delete + insert)', async () => {
      let buffer = await compiler.compileDeck(makeLargeDeck(50));

      buffer = await patchCompiler.compile(buffer, {
        type: 'patch',
        operations: [
          { op: 'delete_slide', slideNumber: 25 },
          { op: 'insert_slide', slideNumber: 11, spec: makeSlide('Inserted') },
        ],
      });

      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
      const info = await reader.parse(buffer);
      expect(info.slideCount).toBe(50); // -1 +1
    }, 30000);
  });

  describe('empty and minimal slides', () => {
    it('generates a slide with 0 elements', async () => {
      const deck: DeckSpec = {
        title: 'Empty',
        slides: [{ slideNumber: 1, spec: { type: 'structured', elements: [] } }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
      expect(v.structure.slideCount).toBe(1);
    });

    it('generates a single-element slide', async () => {
      const deck: DeckSpec = {
        title: 'Minimal',
        slides: [{
          slideNumber: 1,
          spec: { type: 'structured', elements: [{ type: 'title', content: 'Solo', position: { x: 1, y: 1, w: 8, h: 1 } }] },
        }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
    });
  });

  describe('special characters', () => {
    it('handles emoji in text', async () => {
      const deck: DeckSpec = {
        title: 'Emoji Test',
        slides: [{
          slideNumber: 1,
          spec: { type: 'structured', elements: [{ type: 'title', content: '🚀 Launch Day 🎉', position: { x: 1, y: 1, w: 8, h: 1 } }] },
        }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
    });

    it('handles CJK characters', async () => {
      const deck: DeckSpec = {
        title: '中文测试',
        slides: [{
          slideNumber: 1,
          spec: { type: 'structured', elements: [
            { type: 'title', content: '你好世界', position: { x: 1, y: 1, w: 8, h: 1 } },
            { type: 'text', content: 'こんにちは世界 · 안녕하세요', position: { x: 1, y: 2.5, w: 8, h: 1 } },
          ] },
        }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
    });

    it('handles XML-sensitive characters', async () => {
      const deck: DeckSpec = {
        title: 'XML Escape',
        slides: [{
          slideNumber: 1,
          spec: { type: 'structured', elements: [
            { type: 'title', content: 'A < B & C > D "quoted"', position: { x: 1, y: 1, w: 8, h: 1 } },
          ] },
        }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
    });

    it('handles very long text', async () => {
      const longText = 'A'.repeat(5000);
      const deck: DeckSpec = {
        title: 'Long Text',
        slides: [{
          slideNumber: 1,
          spec: { type: 'structured', elements: [{ type: 'text', content: longText, position: { x: 1, y: 1, w: 8, h: 4 } }] },
        }],
      };
      const buffer = await compiler.compileDeck(deck);
      const v = await validator.validate(buffer);
      expect(v.valid).toBe(true);
    });
  });

  describe('patch error recovery', () => {
    it('rejects patch with out-of-range slideNumber', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(3));
      const patch: PatchSpec = {
        type: 'patch',
        operations: [{ op: 'delete_slide', slideNumber: 99 }],
      };
      await expect(patchCompiler.compile(buffer, patch)).rejects.toThrow('out of range');
    });

    it('rejects patch with slideNumber 0', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(2));
      const patch: PatchSpec = {
        type: 'patch',
        operations: [{ op: 'delete_slide', slideNumber: 0 }],
      };
      await expect(patchCompiler.compile(buffer, patch)).rejects.toThrow('out of range');
    });

    it('rejects modify_text on deleted slide', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(3));
      const patch: PatchSpec = {
        type: 'patch',
        operations: [
          { op: 'delete_slide', slideNumber: 2 },
          { op: 'modify_text', target: { slideNumber: 2, elementName: 'Title 1' }, text: 'Oops' },
        ],
      };
      await expect(patchCompiler.compile(buffer, patch)).rejects.toThrow('marked for deletion');
    });

    it('rejects modify_style with only borderRadius (unsupported)', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(1));
      const patch: PatchSpec = {
        type: 'patch',
        operations: [
          { op: 'modify_style', target: { slideNumber: 1, elementName: 'Title 1' }, style: { borderRadius: 10 } },
        ],
      };
      await expect(patchCompiler.compile(buffer, patch)).rejects.toThrow('unsupported');
    });

    it('rejects modify_style with no supported fields', async () => {
      const buffer = await compiler.compileDeck(makeLargeDeck(1));
      const patch: PatchSpec = {
        type: 'patch',
        operations: [
          { op: 'modify_style', target: { slideNumber: 1, elementName: 'Title 1' }, style: {} },
        ],
      };
      await expect(patchCompiler.compile(buffer, patch)).rejects.toThrow('at least one supported field');
    });
  });
});
