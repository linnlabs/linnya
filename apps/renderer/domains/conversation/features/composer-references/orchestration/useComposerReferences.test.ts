import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useComposerReferenceStore } from '../store/composerReferenceStore';
import { useComposerReferences } from './useComposerReferences';

describe('useComposerReferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('returns the generated id so a caller can remove exactly the reference it added', () => {
    const composerReferences = useComposerReferences();
    const store = useComposerReferenceStore();

    const referenceId = composerReferences.addReference({
      text: 'Node A',
      pluginId: 'fixture-plugin',
      kind: 'node',
      uri: 'linnya://fixture-plugin/document-1#node/node-a',
    });

    expect(store.references).toHaveLength(1);
    expect(store.references[0]?.id).toBe(referenceId);

    composerReferences.removeReference(referenceId);
    expect(store.references).toEqual([]);
  });
});
