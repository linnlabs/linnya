import { describe, expect, it } from 'vitest';
import { parseStoredDeckSpec } from './presentationDocumentRecordCodec';

describe('parseStoredDeckSpec line-spacing admission', () => {
  it('reads a legacy revision into the current explicit contract without rewriting storage', () => {
    const storedJson = JSON.stringify({
      title: 'Legacy',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'text',
            content: 'Body',
            position: { x: 1, y: 1, w: 3, h: 1 },
            style: { lineSpacing: 1.18 },
          }],
        },
      }],
    });

    const deck = parseStoredDeckSpec(storedJson);
    const slide = deck.slides[0]?.spec;

    expect(slide?.elements[0]?.style?.lineSpacing)
      .toEqual({ kind: 'multiple', value: 1.18 });
    expect(storedJson).toContain('"lineSpacing":1.18');
  });
});
