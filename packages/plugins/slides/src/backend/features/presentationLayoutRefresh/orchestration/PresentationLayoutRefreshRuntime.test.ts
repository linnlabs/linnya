import { describe, expect, it, vi } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import { DECK_LAYOUT_VERSION } from '@plugin/slides/shared/deckSpec';
import { PresentationLayoutRefreshRuntime } from './PresentationLayoutRefreshRuntime';

const STALE_DECK: DeckSpec = { title: 'Deck', theme: { colors: { primary: '#112233' } }, slides: [] };
const FRESH_DECK: DeckSpec = { ...STALE_DECK, layoutVersion: DECK_LAYOUT_VERSION };

function createRuntime(layoutVersion: number | null, build = vi.fn(async () => FRESH_DECK)) {
  const repository = {
    getPresentationLayoutState: vi.fn(async () => ({ currentRevisionId: 'revision-3', layoutVersion })),
    getPresentationRenderSource: vi.fn(async () => ({
      nodeId: 'deck', currentRevisionId: 'revision-3', currentRevision: 3,
      deckSource: 'compose({ title: "Deck", slides: [] });', deckSpec: STALE_DECK, title: 'Deck',
    })),
    refreshPresentationDeckSpec: vi.fn(async () => true),
  };
  return { repository, build, runtime: new PresentationLayoutRefreshRuntime({ repository, buildDeckSpecFromSource: build }) };
}

describe('PresentationLayoutRefreshRuntime', () => {
  it('leaves a current materialization untouched without reading the full deck', async () => {
    const { repository, build, runtime } = createRuntime(DECK_LAYOUT_VERSION);
    await runtime.ensureCurrent('deck');
    expect(repository.getPresentationRenderSource).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('recompiles a stale materialization from the same source and theme, once per revision', async () => {
    const { repository, build, runtime } = createRuntime(null);
    await Promise.all([runtime.ensureCurrent('deck'), runtime.ensureCurrent('deck')]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith({
      nodeId: 'deck', source: 'compose({ title: "Deck", slides: [] });', theme: STALE_DECK.theme,
    });
    expect(repository.refreshPresentationDeckSpec).toHaveBeenCalledWith('deck', 'revision-3', FRESH_DECK);
  });

  it('keeps the stored materialization when the source no longer compiles and does not retry it', async () => {
    const build = vi.fn(async (): Promise<DeckSpec> => { throw new Error('source broke'); });
    const { repository, runtime } = createRuntime(null, build);
    await expect(runtime.ensureCurrent('deck')).resolves.toBeUndefined();
    await runtime.ensureCurrent('deck');
    expect(build).toHaveBeenCalledTimes(1);
    expect(repository.refreshPresentationDeckSpec).not.toHaveBeenCalled();
  });
});
