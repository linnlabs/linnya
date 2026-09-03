import type { DeckSpec } from '@plugin/slides/shared';

export function buildInitialPresentationDeck(title: string): DeckSpec {
  return {
    title,
    layout: '16x9',
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'structured',
          background: { color: '#FFFFFF' },
          elements: [],
        },
      },
    ],
  };
}
