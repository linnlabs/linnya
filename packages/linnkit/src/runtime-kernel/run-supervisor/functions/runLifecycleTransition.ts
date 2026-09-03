import type { RunStatus } from '../runRegistryStorePort';

export type RunLifecycleWriteStatus = Extract<
  RunStatus,
  'running' | 'awaiting_user' | 'completed' | 'failed' | 'cancelled'
>;

export type RunLifecycleTransitionDecision =
  | { kind: 'apply' }
  | { kind: 'skip_terminal'; terminalStatus: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'> };

export function isRunTerminalStatus(
  status: RunStatus,
): status is Extract<RunStatus, 'completed' | 'failed' | 'cancelled'> {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function decideRunLifecycleTransition(
  currentStatus: RunStatus,
  nextStatus: RunLifecycleWriteStatus,
): RunLifecycleTransitionDecision {
  if (isRunTerminalStatus(currentStatus)) {
    return { kind: 'skip_terminal', terminalStatus: currentStatus };
  }

  return { kind: 'apply' };
}
