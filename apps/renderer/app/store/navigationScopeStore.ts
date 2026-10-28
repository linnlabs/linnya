import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import type {
  DraftNavigationScopeState,
  NavigationScope,
} from '../navigation/definitions/navigationScope';
import { getNavigationScopeKey } from '../navigation/functions/navigationScope';
import {
  NAVIGATION_SCOPE_STORAGE_KEY,
  readInitialNavigationScope,
} from '../navigation/adapters/navigationScopePersistence';

/** 应用级导航状态。调用方通过 navigation 公开入口协调切换，不能直接改写内部状态。 */
export const useNavigationScopeState = defineStore(
  'navigationScope',
  () => {
    const currentScope = ref<NavigationScope>(readInitialNavigationScope());
    const currentDraft = ref<DraftNavigationScopeState | null>({
      scope: currentScope.value,
      createdAt: Date.now(),
    });
    const scopeVersion = ref(0);
    const lastActiveConversationEntries = ref<[string, string][]>([]);
    const currentScopeKey = computed(() => getNavigationScopeKey(currentScope.value));
    const currentProjectId = computed(() =>
      currentScope.value.kind === 'project' ? currentScope.value.projectId : null
    );
    const isLinnyaAssistantScope = computed(() => currentScope.value.kind === 'linnya-assistant');
    const lastActiveConversationByScope = computed(
      () => new Map(lastActiveConversationEntries.value)
    );
    const currentDraftScopeKey = computed(() =>
      currentDraft.value ? getNavigationScopeKey(currentDraft.value.scope) : null
    );
    const isCurrentScopeDraft = computed(
      () => currentDraftScopeKey.value === currentScopeKey.value
    );

    function commitScope(scope: NavigationScope, version: number): void {
      currentScope.value = scope;
      scopeVersion.value = version;
    }
    function setDraft(draft: DraftNavigationScopeState | null): void {
      currentDraft.value = draft;
    }
    function setLastActiveConversations(entries: [string, string][]): void {
      lastActiveConversationEntries.value = entries;
    }

    return {
      currentScope,
      currentDraft,
      scopeVersion,
      lastActiveConversationEntries,
      currentScopeKey,
      currentProjectId,
      isLinnyaAssistantScope,
      lastActiveConversationByScope,
      currentDraftScopeKey,
      isCurrentScopeDraft,
      commitScope,
      setDraft,
      setLastActiveConversations,
    };
  },
  {
    persist: {
      key: NAVIGATION_SCOPE_STORAGE_KEY,
      storage: getRendererPersistStorage(),
      pick: ['currentScope', 'currentDraft', 'lastActiveConversationEntries'],
    },
  }
);
