import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import mitt from 'mitt';
import { getRendererPersistStorage } from '../persistence/rendererPersistStorage';

export interface ProjectWorkspaceScope {
  kind: 'project';
  projectId: string;
}

export interface LinnyaAssistantWorkspaceScope {
  kind: 'linnya-assistant';
}

export type WorkspaceScope = ProjectWorkspaceScope | LinnyaAssistantWorkspaceScope;

export interface WorkspaceScopeChangePayload {
  scope: WorkspaceScope;
  previousScope: WorkspaceScope;
  scopeVersion: number;
}

interface DraftWorkspaceScopeState {
  scope: WorkspaceScope;
  createdAt: number;
}

type WorkspaceScopeEvents = {
  scopeWillChange: WorkspaceScopeChangePayload;
  scopeDidChange: WorkspaceScopeChangePayload;
};

const LINNYA_ASSISTANT_SCOPE_KEY = 'linnya-assistant';
const PROJECT_SCOPE_PREFIX = 'project:';
const emitter = mitt<WorkspaceScopeEvents>();

function cloneScope(scope: WorkspaceScope): WorkspaceScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

export function getWorkspaceScopeKey(scope: WorkspaceScope): string {
  return scope.kind === 'project'
    ? `${PROJECT_SCOPE_PREFIX}${scope.projectId}`
    : LINNYA_ASSISTANT_SCOPE_KEY;
}

export function areWorkspaceScopesEqual(a: WorkspaceScope, b: WorkspaceScope): boolean {
  return getWorkspaceScopeKey(a) === getWorkspaceScopeKey(b);
}

function createDraft(scope: WorkspaceScope): DraftWorkspaceScopeState {
  return {
    scope: cloneScope(scope),
    createdAt: Date.now(),
  };
}

function normalizePersistedScope(value: unknown): WorkspaceScope | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { kind?: unknown; projectId?: unknown };
  if (record.kind === 'project' && typeof record.projectId === 'string' && record.projectId.trim().length > 0) {
    return { kind: 'project', projectId: record.projectId };
  }
  if (record.kind === 'linnya-assistant') {
    return { kind: 'linnya-assistant' };
  }
  return null;
}

function readLegacyProjectScope(): WorkspaceScope | null {
  const storage = getRendererPersistStorage();
  try {
    const raw = storage.getItem('project-scope');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { currentProjectId?: unknown };
    if (typeof parsed.currentProjectId === 'string' && parsed.currentProjectId.trim().length > 0) {
      return { kind: 'project', projectId: parsed.currentProjectId };
    }
  } catch (error) {
    console.warn('[workspaceScopeStore] 旧 project-scope 迁移读取失败：', error);
  }
  return null;
}

function cleanupLegacyScopeStorage(): void {
  const storage = getRendererPersistStorage();
  storage.removeItem('project-scope');
  storage.removeItem('conversation-scope');
}

export const useWorkspaceScopeStore = defineStore('workspaceScope', () => {
  const migratedInitialScope = readLegacyProjectScope() ?? { kind: 'linnya-assistant' as const };
  const currentScope = ref<WorkspaceScope>(migratedInitialScope);
  const currentDraft = ref<DraftWorkspaceScopeState | null>(createDraft(migratedInitialScope));
  const scopeVersion = ref(0);
  const lastActiveConversationEntries = ref<[string, string][]>([]);

  cleanupLegacyScopeStorage();

  const currentScopeKey = computed(() => getWorkspaceScopeKey(currentScope.value));
  const currentProjectId = computed(() => (
    currentScope.value.kind === 'project' ? currentScope.value.projectId : null
  ));
  const isLinnyaAssistantScope = computed(() => currentScope.value.kind === 'linnya-assistant');
  const lastActiveConversationByScope = computed(() => new Map(lastActiveConversationEntries.value));
  const currentDraftScopeKey = computed(() => (
    currentDraft.value ? getWorkspaceScopeKey(currentDraft.value.scope) : null
  ));
  const isCurrentScopeDraft = computed(() => currentDraftScopeKey.value === currentScopeKey.value);

  const emitEvent = (
    event: keyof WorkspaceScopeEvents,
    payload: WorkspaceScopeChangePayload,
  ) => {
    emitter.emit(event, payload);
  };

  const enterScope = (scope: WorkspaceScope): WorkspaceScopeChangePayload => {
    const nextScope = cloneScope(scope);
    const previousScope = cloneScope(currentScope.value);
    if (areWorkspaceScopesEqual(previousScope, nextScope)) {
      return {
        scope: nextScope,
        previousScope,
        scopeVersion: scopeVersion.value,
      };
    }

    scopeVersion.value += 1;
    const payload = {
      scope: nextScope,
      previousScope,
      scopeVersion: scopeVersion.value,
    };
    emitEvent('scopeWillChange', payload);
    currentScope.value = nextScope;
    emitEvent('scopeDidChange', payload);
    return payload;
  };

  const enterProject = (projectId: string): WorkspaceScopeChangePayload => {
    if (!projectId.trim()) {
      throw new Error('[workspaceScopeStore] projectId is required for enterProject.');
    }
    return enterScope({ kind: 'project', projectId });
  };

  const enterLinnyaAssistant = (): WorkspaceScopeChangePayload => {
    return enterScope({ kind: 'linnya-assistant' });
  };

  const startDraft = (scope: WorkspaceScope = currentScope.value): void => {
    const nextScope = cloneScope(scope);
    enterScope(nextScope);
    currentDraft.value = createDraft(nextScope);
  };

  const materializeCurrentDraft = (conversationId: string): void => {
    if (!conversationId) return;
    rememberLastActiveConversation(currentScope.value, conversationId);
    currentDraft.value = null;
  };

  function rememberLastActiveConversation(scope: WorkspaceScope, conversationId: string): void {
    if (!conversationId) return;
    const next = new Map(lastActiveConversationEntries.value);
    next.set(getWorkspaceScopeKey(scope), conversationId);
    lastActiveConversationEntries.value = Array.from(next.entries());
  }

  function forgetLastActiveConversation(scope: WorkspaceScope): void {
    const next = new Map(lastActiveConversationEntries.value);
    next.delete(getWorkspaceScopeKey(scope));
    lastActiveConversationEntries.value = Array.from(next.entries());
  }

  function getLastActiveConversation(scope: WorkspaceScope): string | null {
    return lastActiveConversationByScope.value.get(getWorkspaceScopeKey(scope)) ?? null;
  }

  const onScopeWillChange = (handler: (payload: WorkspaceScopeChangePayload) => void) => {
    emitter.on('scopeWillChange', handler);
    return () => emitter.off('scopeWillChange', handler);
  };

  const onScopeDidChange = (handler: (payload: WorkspaceScopeChangePayload) => void) => {
    emitter.on('scopeDidChange', handler);
    return () => emitter.off('scopeDidChange', handler);
  };

  const reset = (): void => {
    currentScope.value = { kind: 'linnya-assistant' };
    currentDraft.value = createDraft(currentScope.value);
    scopeVersion.value = 0;
    lastActiveConversationEntries.value = [];
  };

  return {
    currentScope,
    currentScopeKey,
    currentProjectId,
    currentDraft,
    currentDraftScopeKey,
    isCurrentScopeDraft,
    isLinnyaAssistantScope,
    scopeVersion,
    lastActiveConversationEntries,
    enterScope,
    enterProject,
    enterLinnyaAssistant,
    startDraft,
    materializeCurrentDraft,
    rememberLastActiveConversation,
    forgetLastActiveConversation,
    getLastActiveConversation,
    onScopeWillChange,
    onScopeDidChange,
    reset,
  };
}, {
  persist: {
    key: 'workspace-scope',
    storage: getRendererPersistStorage(),
    pick: ['currentScope', 'currentDraft', 'lastActiveConversationEntries'],
  },
});
