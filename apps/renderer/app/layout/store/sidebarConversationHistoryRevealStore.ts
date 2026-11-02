import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { NavigationScope } from '@/app/navigation';

export interface SidebarConversationHistoryRevealRequest {
  id: number;
  scope: NavigationScope;
  requestedAt: number;
}

function cloneScope(scope: NavigationScope): NavigationScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

export const useSidebarConversationHistoryRevealStore = defineStore('sidebarConversationHistoryReveal', () => {
  const latestRequest = ref<SidebarConversationHistoryRevealRequest | null>(null);
  let nextRequestId = 0;

  const requestReveal = (scope: NavigationScope): void => {
    latestRequest.value = {
      id: nextRequestId + 1,
      scope: cloneScope(scope),
      requestedAt: Date.now(),
    };
    nextRequestId = latestRequest.value.id;
  };

  /** 历史展开是显式 UI 意图，不能随导航到无项目首页而自动出现。 */
  const dismiss = (): void => {
    latestRequest.value = null;
  };

  return {
    latestRequest,
    requestReveal,
    dismiss,
  };
});
