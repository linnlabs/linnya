import { describe, expect, it } from 'vitest';
import type { DocumentTabIdentity, DocumentTabsState } from '../definitions/documentTabs';
import {
  DOCUMENT_TABS_CLOSED_LIMIT,
  closeDocumentTabs,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  createDocumentTabsState,
  cycleRecentDocumentTab,
  openDocumentTab,
  popClosedDocumentTab,
  removeDocumentTabs,
} from './documentTabsState';

function doc(id: string): DocumentTabIdentity {
  return { id, type: 'editor', projectId: 'p1', displayName: id.toUpperCase(), parentId: null };
}

function openAll(ids: readonly string[]): DocumentTabsState {
  return ids.reduce((state, id) => openDocumentTab(state, doc(id)), createDocumentTabsState());
}

const order = (state: DocumentTabsState) => state.tabs.map(tab => tab.id);

describe('documentTabsState', () => {
  it('opens every new document in its own tab', () => {
    let state = openAll(['a', 'b']);
    state = openDocumentTab(state, doc('c'));
    expect(order(state)).toEqual(['a', 'b', 'c']);
    expect(state.recent).toEqual(['c', 'b', 'a']);
  });

  it('re-activates already open documents and keeps their names', () => {
    let state = openAll(['a', 'b']);
    state = openDocumentTab(state, { ...doc('a'), displayName: null });
    expect(order(state)).toEqual(['a', 'b']);
    expect(state.recent[0]).toBe('a');
    expect(state.tabs.find(tab => tab.id === 'a')?.displayName).toBe('A');
  });

  it('inserts new tabs to the right of the active tab', () => {
    let state = openAll(['a', 'b', 'c']);
    state = openDocumentTab(state, doc('a'));
    state = openDocumentTab(state, doc('d'));
    expect(order(state)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('closing the active tab moves to the most recently used remaining tab', () => {
    let state = openAll(['a', 'b', 'c']);
    state = openDocumentTab(state, doc('a'));
    state = openDocumentTab(state, doc('c'));
    const result = closeDocumentTabs(state, ['c']);
    expect(result.activeClosed).toBe(true);
    expect(result.nextActive?.id).toBe('a');
    expect(order(result.state)).toEqual(['a', 'b']);
  });

  it('closing the last tab reports no next tab, and inactive closes keep the active tab', () => {
    const last = closeDocumentTabs(openAll(['a']), ['a']);
    expect(last).toMatchObject({ activeClosed: true, nextActive: null });

    const inactive = closeDocumentTabs(openAll(['a', 'b']), ['a']);
    expect(inactive).toMatchObject({ activeClosed: false, nextActive: null });
  });

  it('closes others and to the right', () => {
    const state = openAll(['a', 'b', 'c', 'd']);
    const others = closeOtherDocumentTabs(state, 'b');
    expect(order(others.state)).toEqual(['b']);
    expect(others.nextActive?.id).toBe('b');

    const right = closeDocumentTabsToRight(state, 'b');
    expect(order(right.state)).toEqual(['a', 'b']);
    expect(right.nextActive?.id).toBe('b');
  });

  it('reopens closed tabs newest first and skips ones already open again', () => {
    let state = closeDocumentTabs(openAll(['a', 'b', 'c']), ['a']).state;
    state = closeDocumentTabs(state, ['b']).state;
    state = openDocumentTab(state, doc('b'));

    const popped = popClosedDocumentTab(state);
    expect(popped.tab?.id).toBe('a');
    expect(popClosedDocumentTab(popped.state).tab).toBeNull();
  });

  it('keeps a bounded closed history', () => {
    const ids = Array.from({ length: DOCUMENT_TABS_CLOSED_LIMIT + 5 }, (_, index) => `d${index}`);
    const state = closeDocumentTabs(openAll(ids), ids).state;
    expect(state.closed).toHaveLength(DOCUMENT_TABS_CLOSED_LIMIT);
    expect(state.closed[state.closed.length - 1]?.id).toBe(ids[ids.length - 1]);
  });

  it('removes deleted documents everywhere without adding them to the closed history', () => {
    let state = closeDocumentTabs(openAll(['a', 'b', 'c']), ['a']).state;
    state = removeDocumentTabs(state, ['a', 'b']);
    expect(order(state)).toEqual(['c']);
    expect(state.recent).toEqual(['c']);
    expect(state.closed).toEqual([]);
  });

  it('cycles by recent use', () => {
    let state = openAll(['a', 'b', 'c']);
    expect(cycleRecentDocumentTab(state, 1)?.id).toBe('b');
    expect(cycleRecentDocumentTab(state, -1)?.id).toBe('a');
    state = closeDocumentTabs(state, ['a', 'b']).state;
    expect(cycleRecentDocumentTab(state, 1)).toBeNull();
  });
});
