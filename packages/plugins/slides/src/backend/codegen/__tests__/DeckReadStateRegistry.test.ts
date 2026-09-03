import { describe, expect, it } from 'vitest';

import { DeckReadStateRegistry } from '../DeckReadStateRegistry.js';

describe('DeckReadStateRegistry', () => {
  it('isolates read state by conversation and deck id', () => {
    const registry = new DeckReadStateRegistry();

    registry.set('conv-1', 'deck-1', {
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'source one',
      isPartialView: false,
      readAtMs: 100,
    });
    registry.set('conv-2', 'deck-1', {
      sourceKey: 'draft:hash-2',
      contentSnapshot: 'source two',
      isPartialView: true,
      offset: 10,
      limit: 20,
      readAtMs: 200,
    });

    expect(registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'source one',
      isPartialView: false,
    });
    expect(registry.get('conv-2', 'deck-1')).toMatchObject({
      sourceKey: 'draft:hash-2',
      contentSnapshot: 'source two',
      isPartialView: true,
      offset: 10,
      limit: 20,
    });
    expect(registry.get('conv-1', 'deck-2')).toBeUndefined();
  });

  it('keeps full read state when the latest read is only a locator slice', () => {
    const registry = new DeckReadStateRegistry();

    registry.set('conv-1', 'deck-1', {
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'full source',
      isPartialView: false,
      readAtMs: 100,
    });
    registry.set('conv-1', 'deck-1', {
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'slice',
      isPartialView: true,
      offset: 10,
      limit: 2,
      readAtMs: 200,
    });

    expect(registry.get('conv-1', 'deck-1')).toMatchObject({
      contentSnapshot: 'slice',
      isPartialView: true,
      offset: 10,
      limit: 2,
    });
    expect(registry.getFullRead('conv-1', 'deck-1')).toMatchObject({
      contentSnapshot: 'full source',
      isPartialView: false,
    });
  });

  it('invalidates one conversation entry without touching other conversations', () => {
    const registry = new DeckReadStateRegistry();

    registry.set('conv-1', 'deck-1', {
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'source one',
      isPartialView: false,
      readAtMs: 100,
    });
    registry.set('conv-2', 'deck-1', {
      sourceKey: 'draft:hash-2',
      contentSnapshot: 'source two',
      isPartialView: false,
      readAtMs: 200,
    });

    registry.invalidate('conv-1', 'deck-1');

    expect(registry.get('conv-1', 'deck-1')).toBeUndefined();
    expect(registry.get('conv-2', 'deck-1')).toMatchObject({
      sourceKey: 'draft:hash-2',
    });
  });

  it('invalidates all read state for one deck across conversations', () => {
    const registry = new DeckReadStateRegistry();

    registry.set('conv-1', 'deck-1', {
      sourceKey: 'compiled:version-1',
      contentSnapshot: 'source one',
      isPartialView: false,
      readAtMs: 100,
    });
    registry.set('conv-2', 'deck-1', {
      sourceKey: 'draft:hash-2',
      contentSnapshot: 'source two',
      isPartialView: false,
      readAtMs: 200,
    });
    registry.set('conv-1', 'deck-2', {
      sourceKey: 'compiled:version-3',
      contentSnapshot: 'source three',
      isPartialView: false,
      readAtMs: 300,
    });

    registry.invalidateAllForDeck('deck-1');

    expect(registry.get('conv-1', 'deck-1')).toBeUndefined();
    expect(registry.get('conv-2', 'deck-1')).toBeUndefined();
    expect(registry.get('conv-1', 'deck-2')).toMatchObject({
      sourceKey: 'compiled:version-3',
    });
  });
});
