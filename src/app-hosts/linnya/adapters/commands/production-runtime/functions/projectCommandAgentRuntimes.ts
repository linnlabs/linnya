import type { CommandProductionScope } from '../definitions/commandProductionScope';

/** Root/child Agent 共享同一 Commands owner，只投影各自需要的 public runtime。 */
export function projectCommandAgentRuntimes(scope: CommandProductionScope) {
  const child = Object.freeze({
    kind: 'enabled' as const,
    agentRunLifecycle: scope.agentRunLifecycle,
  });
  const root = Object.freeze({
    ...child,
    shellToolRuntime: scope.shellToolRuntime,
  });
  return Object.freeze({ root, child });
}
