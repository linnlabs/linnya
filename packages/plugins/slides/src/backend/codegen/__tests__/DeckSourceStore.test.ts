import { describe, expect, it } from 'vitest';

import type { DeckSpec } from '@plugin/slides/shared';
import type {
  PresentationDocumentRecord,
  PresentationRepositoryPort,
} from '../../persistence';
import { DeckSourceStore, DeckSourceStoreError } from '../DeckSourceStore.js';

const deckSpec: DeckSpec = {
  title: 'Deck',
  layout: '16x9',
  slides: [
    {
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [],
      },
    },
  ],
};

function makeDocument(
  overrides: Partial<Pick<PresentationDocumentRecord, 'deckSource'>> = {},
): PresentationDocumentRecord {
  return {
    nodeId: 'node-1',
    currentRevisionId: 'revision-1',
    currentRevision: 1,
    deckSpec,
    deckSource: overrides.deckSource ?? 'compose({ title: "Deck", slides: [] });',
    sourceHash: 'source-hash-1',
    pptxBuffer: Buffer.from('pptx'),
    title: 'Deck',
    slideCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeStore(document: PresentationDocumentRecord | null): DeckSourceStore {
  const repository: Pick<PresentationRepositoryPort, 'getPresentation'> = {
    async getPresentation() {
      return document;
    },
  };
  return new DeckSourceStore(repository);
}

async function expectNotCodegenReady(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DeckSourceStoreError);
    expect((error as DeckSourceStoreError).code).toBe('deck_not_codegen_ready');
  }
}

describe('DeckSourceStore', () => {
  it('returns current document metadata and source for a document with non-empty deckSource', async () => {
    const source = 'compose({ title: "Deck", slides: [] });';
    const store = makeStore(makeDocument({ deckSource: source }));

    await expect(store.requireCodegenReady('node-1')).resolves.toEqual({
      document: expect.objectContaining({
        currentRevisionId: 'revision-1',
        currentRevision: 1,
      }),
      source,
    });
  });

  it('rejects missing presentations with a direct not-found error', async () => {
    const store = makeStore(null);

    await expect(store.requireCodegenReady('missing-node')).rejects.toThrow(
      'Presentation not found: missing-node',
    );
  });

  it('rejects documents with whitespace-only deckSource', async () => {
    const store = makeStore(makeDocument({ deckSource: ' \n\t ' }));

    await expectNotCodegenReady(store.requireCodegenReady('node-1'));
  });

  it('reads optional source from the current document', async () => {
    const source = 'compose({ title: "Deck", slides: [] });';
    const store = makeStore(makeDocument({ deckSource: source }));

    await expect(store.readOptionalSource('node-1')).resolves.toEqual({
      document: expect.objectContaining({
        currentRevisionId: 'revision-1',
      }),
      source,
    });
  });

  it('returns null for optional source when no latest version or no non-empty source exists', async () => {
    await expect(makeStore(null).readOptionalSource('missing-node')).resolves.toBeNull();
    await expect(makeStore(makeDocument({ deckSource: '   ' })).readOptionalSource('node-1')).resolves.toBeNull();
  });
});
