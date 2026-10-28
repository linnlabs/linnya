import type { NavigationScope } from '../definitions/navigationScope';

export function cloneNavigationScope(scope: NavigationScope): NavigationScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

export function getNavigationScopeKey(scope: NavigationScope): string {
  return scope.kind === 'project' ? `project:${scope.projectId}` : 'linnya-assistant';
}

export function areNavigationScopesEqual(a: NavigationScope, b: NavigationScope): boolean {
  return getNavigationScopeKey(a) === getNavigationScopeKey(b);
}
