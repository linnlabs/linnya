import { reactive, readonly } from 'vue';
import { storeToRefs } from 'pinia';
import mitt from 'mitt';
import { useNavigationScopeState } from '../../store/navigationScopeStore';
import type {
  NavigationScope,
  NavigationScopeChangePayload,
  NavigationScopeEvents,
} from '../definitions/navigationScope';
import {
  areNavigationScopesEqual,
  cloneNavigationScope,
  getNavigationScopeKey,
} from '../functions/navigationScope';

function createNavigationScope(state: ReturnType<typeof useNavigationScopeState>) {
  // 事件与当前 Pinia 状态同寿命，多个应用/测试实例不能共享切换事件。
  const events = mitt<NavigationScopeEvents>();
  function enterScope(scope: NavigationScope): NavigationScopeChangePayload {
    const next = cloneNavigationScope(scope);
    const previous = cloneNavigationScope(state.currentScope);
    const changed = !areNavigationScopesEqual(previous, next);
    const payload = {
      scope: next,
      previousScope: previous,
      scopeVersion: state.scopeVersion + (changed ? 1 : 0),
    };
    if (!changed) return payload;
    events.emit('scopeWillChange', payload);
    state.commitScope(next, payload.scopeVersion);
    events.emit('scopeDidChange', payload);
    return payload;
  }
  function rememberLastActiveConversation(scope: NavigationScope, conversationId: string): void {
    if (!conversationId) return;
    const entries = new Map(state.lastActiveConversationEntries);
    entries.set(getNavigationScopeKey(scope), conversationId);
    state.setLastActiveConversations(Array.from(entries));
  }
  function forgetLastActiveConversation(scope: NavigationScope): void {
    const entries = new Map(state.lastActiveConversationEntries);
    entries.delete(getNavigationScopeKey(scope));
    state.setLastActiveConversations(Array.from(entries));
  }
  function startDraft(scope: NavigationScope = state.currentScope): void {
    const next = cloneNavigationScope(scope);
    enterScope(next);
    state.setDraft({ scope: next, createdAt: Date.now() });
  }
  // 必须先保留 ref 再包装只读视图；提前 readonly 后展开会解包为当时的值。
  return readonly(
    reactive({
      ...storeToRefs(state),
      enterScope,
      enterProject(projectId: string) {
        if (!projectId.trim())
          throw new Error('[navigationScope] projectId is required for enterProject.');
        return enterScope({ kind: 'project', projectId });
      },
      enterLinnyaAssistant: () => enterScope({ kind: 'linnya-assistant' }),
      startDraft,
      materializeCurrentDraft(conversationId: string) {
        if (!conversationId) return;
        rememberLastActiveConversation(state.currentScope, conversationId);
        state.setDraft(null);
      },
      rememberLastActiveConversation,
      forgetLastActiveConversation,
      getLastActiveConversation: (scope: NavigationScope) =>
        state.lastActiveConversationByScope.get(getNavigationScopeKey(scope)) ?? null,
      onScopeWillChange(handler: (payload: NavigationScopeChangePayload) => void) {
        events.on('scopeWillChange', handler);
        return () => events.off('scopeWillChange', handler);
      },
      onScopeDidChange(handler: (payload: NavigationScopeChangePayload) => void) {
        events.on('scopeDidChange', handler);
        return () => events.off('scopeDidChange', handler);
      },
      reset() {
        state.commitScope({ kind: 'linnya-assistant' }, 0);
        state.setDraft({ scope: { kind: 'linnya-assistant' }, createdAt: Date.now() });
        state.setLastActiveConversations([]);
      },
    })
  );
}

const scopes = new WeakMap<
  ReturnType<typeof useNavigationScopeState>,
  ReturnType<typeof createNavigationScope>
>();

/** 向各 domain 暴露只读导航状态与显式动作，不暴露内部 store 的 mutation。 */
export function useNavigationScope() {
  const state = useNavigationScopeState();
  let scope = scopes.get(state);
  if (!scope) {
    scope = createNavigationScope(state);
    scopes.set(state, scope);
  }
  return scope;
}
