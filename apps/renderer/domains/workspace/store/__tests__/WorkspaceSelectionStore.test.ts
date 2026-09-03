import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWorkspaceSelectionStore } from '../WorkspaceSelectionStore';

describe('WorkspaceSelectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('Shift 范围选择固定普通点击建立的锚点', () => {
    const store = useWorkspaceSelectionStore();
    const tree = ['a', 'b', 'c', 'd'].map(id => ({ id }));

    store.selectSingle('b');
    store.selectRange(tree, 'd');
    store.selectRange(tree, 'a');

    expect([...store.selectedNodeIds]).toEqual(['b', 'c', 'd', 'a']);
    expect(store.lastSelectedNodeId).toBe('b');
  });
});
