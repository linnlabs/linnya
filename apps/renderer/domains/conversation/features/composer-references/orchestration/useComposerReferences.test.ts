import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useComposerReferenceStore } from '../store/composerReferenceStore';
import { useComposerReferences } from './useComposerReferences';

describe('useComposerReferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('重复身份只在同owner/kind且仍在composer时合并，移除后可以再加', () => {
    const references = useComposerReferences();
    const input = { pluginId: 'fixture', kind: 'selection', text: '正文', deduplicationKey: 'document:c1,c2' };
    const first = references.addReference(input);
    expect(references.addReference(input)).toBe(first);
    expect(references.references.value).toHaveLength(1);
    references.addReference({ ...input, pluginId: 'another' });
    expect(references.references.value).toHaveLength(2);
    references.removeReference(first);
    expect(references.addReference(input)).not.toBe(first);
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
