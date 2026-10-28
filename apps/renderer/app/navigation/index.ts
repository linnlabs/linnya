export type {
  NavigationScope,
  ProjectNavigationScope,
  LinnyaAssistantNavigationScope,
  NavigationScopeChangePayload,
} from './definitions/navigationScope';
export { areNavigationScopesEqual, getNavigationScopeKey } from './functions/navigationScope';
export { useNavigationScope } from './orchestration/useNavigationScope';
