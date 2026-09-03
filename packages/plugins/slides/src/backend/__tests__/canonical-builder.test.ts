import { describe, expect, it } from 'vitest';import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder.js';
import type { PresentationInfo } from '@plugin/slides/shared';

const builder = new CanonicalBuilder();

function makeInfo(overrides?: Partial<PresentationInfo>): PresentationInfo {
  return {
    slideCount: 1,
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        number: 1,
        elements: [
          { name: 'Title 1', creationId: 'cid-aaa', type: 'text', text: 'Hello', position: { x: 1, y: 1, w: 8, h: 1 } },
          { name: 'Shape 0', type: 'shape', position: { x: 2, y: 3, w: 2, h: 2 } },
        ],
      },
    ],
    theme: { colors: { accent1: '#FF0000' }, fonts: { major: 'Arial', minor: 'Calibri' } },
    masters: [{ name: 'Master 1', layouts: ['Layout 1'] }],
    ...overrides,
  };
}

describe('CanonicalBuilder', () => {
  it('builds a CanonicalDeck from PresentationInfo', () => {
    const info = makeInfo();
    const deck = builder.build('node-1', 1, 'Test', info);

    expect(deck.nodeId).toBe('node-1');
    expect(deck.versionNumber).toBe(1);
    expect(deck.title).toBe('Test');
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].slideId).toBe('s1');
    expect(deck.slides[0].elements).toHaveLength(2);
    expect(deck.masterCount).toBe(1);
  });

  it('uses creationId for elementId when available', () => {
    const info = makeInfo();
    const deck = builder.build('n', 1, 'T', info);
    expect(deck.slides[0].elements[0].elementId).toBe('cid-cid-aaa');
  });

  it('falls back to position hash when no creationId', () => {
    const info = makeInfo();
    const deck = builder.build('n', 1, 'T', info);
    const shapeEl = deck.slides[0].elements[1];
    expect(shapeEl.elementId).toMatch(/^s1-tshape-/);
    expect(shapeEl.elementId).toContain('2');
    expect(shapeEl.elementId).toContain('3');
  });

  it('falls back to index when no creationId and no position', () => {
    const info = makeInfo({
      slides: [{
        number: 1,
        elements: [{ name: 'X', type: 'other' }],
      }],
    });
    const deck = builder.build('n', 1, 'T', info);
    expect(deck.slides[0].elements[0].elementId).toBe('s1-tother-x-i0');
  });

  it('generates stable elementIds across two builds', () => {
    const info1 = makeInfo();
    const info2 = makeInfo();
    const deck1 = builder.build('n', 1, 'T', info1);
    const deck2 = builder.build('n', 1, 'T', info2);

    expect(deck1.slides[0].elements.map((e) => e.elementId))
      .toEqual(deck2.slides[0].elements.map((e) => e.elementId));
  });

  it('keeps fallback elementIds unique for overlapping elements', () => {
    const info = makeInfo({
      slides: [{
        number: 1,
        elements: [
          { name: 'Overlay Box', type: 'shape', position: { x: 2, y: 2, w: 4, h: 2 } },
          { name: 'Overlay Text', type: 'text', text: 'Inside', position: { x: 2, y: 2, w: 4, h: 2 } },
        ],
      }],
    });

    const deck = builder.build('n', 1, 'T', info);
    const ids = deck.slides[0].elements.map((element) => element.elementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps roles correctly', () => {
    const info = makeInfo({
      slides: [{
        number: 1,
        elements: [
          { name: 'Title 1', type: 'text', text: 'Hi', position: { x: 1, y: 1, w: 8, h: 1 } },
          { name: 'Chart 1', type: 'chart', chartType: 'bar', position: { x: 1, y: 2, w: 8, h: 3 } },
          { name: 'Table 1', type: 'table', position: { x: 1, y: 5, w: 8, h: 2 } },
          { name: 'Pic 1', type: 'image', imageRef: '../media/img.png', position: { x: 1, y: 7, w: 4, h: 3 } },
          { name: 'Group 1', type: 'group', position: { x: 0, y: 0, w: 10, h: 5 } },
          { name: 'Other 1', type: 'other' },
        ],
      }],
    });
    const deck = builder.build('n', 1, 'T', info);
    const roles = deck.slides[0].elements.map((e) => e.role);
    expect(roles).toEqual(['title', 'chart', 'table', 'image', 'group', 'other']);
  });

  it('preserves patchMeta', () => {
    const info = makeInfo();
    const deck = builder.build('n', 1, 'T', info);
    expect(deck.slides[0].elements[0].patchMeta).toEqual({
      creationId: 'cid-aaa',
      elementName: 'Title 1',
    });
  });

  it('preserves nested group children in canonical elements', () => {
    const info = makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Group 1',
          creationId: 'group-1',
          type: 'group',
          position: { x: 1, y: 1, w: 4, h: 2 },
          children: [{
            name: 'Child Text',
            creationId: 'child-1',
            type: 'text',
            text: 'Inside group',
            position: { x: 1.2, y: 1.3, w: 1.8, h: 0.4 },
          }],
        }],
      }],
    });

    const deck = builder.build('n', 1, 'T', info);
    expect(deck.slides[0].elements[0]).toMatchObject({
      elementId: 'cid-group-1',
      role: 'group',
      children: [{
        elementId: 'cid-child-1',
        role: 'body',
        text: 'Inside group',
        position: { x: 1.2, y: 1.3, w: 1.8, h: 0.4 },
      }],
    });
  });

  describe('enrichElementIds', () => {
    it('writes elementId back to PresentationInfo elements', () => {
      const info = makeInfo();
      expect(info.slides[0].elements[0].elementId).toBeUndefined();

      builder.enrichElementIds(info);

      expect(info.slides[0].elements[0].elementId).toBe('cid-cid-aaa');
      expect(info.slides[0].elements[1].elementId).toMatch(/^s1-tshape-/);
    });

    it('does not overwrite existing elementId', () => {
      const info = makeInfo();
      info.slides[0].elements[0].elementId = 'custom-id';

      builder.enrichElementIds(info);

      expect(info.slides[0].elements[0].elementId).toBe('custom-id');
    });

    it('writes nested child elementId back recursively', () => {
      const info = makeInfo({
        slides: [{
          number: 1,
          elements: [{
            name: 'Group 1',
            creationId: 'group-1',
            type: 'group',
            position: { x: 1, y: 1, w: 4, h: 2 },
            children: [{
              name: 'Child Text',
              creationId: 'child-1',
              type: 'text',
              text: 'Inside group',
              position: { x: 1.2, y: 1.3, w: 1.8, h: 0.4 },
              editableTarget: {
                slideNumber: 1,
                operations: ['modify_text'],
              },
            }],
          }],
        }],
      });

      builder.enrichElementIds(info);

      expect(info.slides[0].elements[0].elementId).toBe('cid-group-1');
      expect(info.slides[0].elements[0].children?.[0]?.elementId).toBe('cid-child-1');
      expect(info.slides[0].elements[0].children?.[0]?.editableTarget?.elementId).toBe('cid-child-1');
    });
  });
});
