import { describe, expect, it } from 'vitest';
import {
  listSlidesReferenceIds,
  resolveSlidesReferenceFocusTarget,
} from './slidesDocumentReference';

const slides = [
  { slideId: 's1' },
  { slideId: 's2' },
];

describe('slidesDocumentReference', () => {
  it('lists deck and slide reference ids', () => {
    expect(listSlidesReferenceIds({
      documentId: 'deck-1',
      slides,
    })).toEqual(['deck-1', 's1', 's2']);
  });

  it('resolves deck and slide focus targets', () => {
    expect(resolveSlidesReferenceFocusTarget({
      documentId: 'deck-1',
      referenceId: 'deck-1',
      slides,
    })).toEqual({ kind: 'deck' });

    expect(resolveSlidesReferenceFocusTarget({
      documentId: 'deck-1',
      referenceId: 's2',
      slides,
    })).toEqual({ kind: 'slide', slideIndex: 1 });

    expect(resolveSlidesReferenceFocusTarget({
      documentId: 'deck-1',
      referenceId: 'missing',
      slides,
    })).toBeNull();
  });
});
