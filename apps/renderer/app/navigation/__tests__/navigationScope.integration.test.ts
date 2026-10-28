import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createPersistedState } from 'pinia-plugin-persistedstate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationScope } from '..';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';

describe('application navigation scope', () => {
  beforeEach(() => {
    const storage = getRendererPersistStorage();
    ['workspace-scope', 'project-scope', 'conversation-scope'].forEach(key =>
      storage.removeItem(key)
    );
    setActivePinia(createPinia());
  });

  it('notifies before and after a project transition and preserves per-project conversation selection', () => {
    const navigation = useNavigationScope();
    navigation.enterProject('first');
    navigation.startDraft();
    navigation.materializeCurrentDraft('conversation-1');
    const observed: (string | null)[] = [];
    navigation.onScopeWillChange(() => observed.push(navigation.currentProjectId));
    navigation.onScopeDidChange(() => observed.push(navigation.currentProjectId));
    navigation.startDraft({ kind: 'project', projectId: 'second' });
    navigation.enterProject('second');
    expect(observed).toEqual(['first', 'second']);
    expect(navigation.currentDraft?.scope).toEqual({ kind: 'project', projectId: 'second' });
    expect(navigation.getLastActiveConversation({ kind: 'project', projectId: 'first' })).toBe(
      'conversation-1'
    );
    expect(
      navigation.getLastActiveConversation({ kind: 'project', projectId: 'second' })
    ).toBeNull();
  });

  it('does not send navigation events to a different application state instance', () => {
    const first = useNavigationScope();
    const onFirst = vi.fn();
    first.onScopeWillChange(onFirst);
    setActivePinia(createPinia());
    const second = useNavigationScope();
    second.enterProject('second-app');
    expect(onFirst).not.toHaveBeenCalled();
    expect(first.currentProjectId).toBeNull();
    expect(second.currentProjectId).toBe('second-app');
  });

  it('hydrates existing navigation selection and drafts without renaming stored data', () => {
    getRendererPersistStorage().setItem(
      'workspace-scope',
      JSON.stringify({
        currentScope: { kind: 'project', projectId: 'persisted' },
        currentDraft: { scope: { kind: 'project', projectId: 'persisted' }, createdAt: 123 },
        lastActiveConversationEntries: [['project:persisted', 'conversation-1']],
      })
    );
    const pinia = createPinia();
    pinia.use(createPersistedState());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const navigation = useNavigationScope();
    expect(navigation.currentProjectId).toBe('persisted');
    expect(navigation.currentDraft?.createdAt).toBe(123);
    expect(navigation.getLastActiveConversation(navigation.currentScope)).toBe('conversation-1');
  });
});
