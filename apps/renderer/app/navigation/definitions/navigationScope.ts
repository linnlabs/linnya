/** 界面当前工作的上下文，不是 Runtime 的数据工作区，也不是宿主目录。 */
export type NavigationScope = { kind: 'project'; projectId: string } | { kind: 'linnya-assistant' };

export type ProjectNavigationScope = Extract<NavigationScope, { kind: 'project' }>;
export type LinnyaAssistantNavigationScope = Extract<NavigationScope, { kind: 'linnya-assistant' }>;

export interface NavigationScopeChangePayload {
  scope: NavigationScope;
  previousScope: NavigationScope;
  scopeVersion: number;
}

export interface DraftNavigationScopeState {
  scope: NavigationScope;
  createdAt: number;
}

export type NavigationScopeEvents = {
  scopeWillChange: NavigationScopeChangePayload;
  scopeDidChange: NavigationScopeChangePayload;
};
