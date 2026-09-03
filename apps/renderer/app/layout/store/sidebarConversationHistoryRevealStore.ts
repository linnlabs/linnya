import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { WorkspaceScope } from '@/shared/stores/workspaceScopeStore';

export interface SidebarConversationHistoryRevealRequest {
  id: number;
  scope: WorkspaceScope;
  requestedAt: number;
}

function cloneScope(scope: WorkspaceScope): WorkspaceScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

export const useSidebarConversationHistoryRevealStore = defineStore('sidebarConversationHistoryReveal', () => {
  const latestRequest = ref<SidebarConversationHistoryRevealRequest | null>(null);
  let nextRequestId = 0;

  const requestReveal = (scope: WorkspaceScope): void => {
    latestRequest.value = {
      id: nextRequestId + 1,
      scope: cloneScope(scope),
      requestedAt: Date.now(),
    };
    nextRequestId = latestRequest.value.id;
  };

  return {
    latestRequest,
    requestReveal,
  };
});
