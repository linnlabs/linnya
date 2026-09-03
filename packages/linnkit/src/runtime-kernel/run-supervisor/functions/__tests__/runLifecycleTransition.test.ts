import { describe, expect, it } from 'vitest';

import {
  decideRunLifecycleTransition,
  isRunTerminalStatus,
  type RunLifecycleWriteStatus,
} from '../runLifecycleTransition';
import type { RunStatus } from '../../runRegistryStorePort';

describe('runLifecycleTransition', () => {
  it('终态之后任何生命周期写入都应跳过，避免反向覆写', () => {
    const terminalStatuses: RunStatus[] = ['completed', 'failed', 'cancelled'];
    const nextStatuses: RunLifecycleWriteStatus[] = [
      'running',
      'awaiting_user',
      'completed',
      'failed',
      'cancelled',
    ];

    for (const currentStatus of terminalStatuses) {
      for (const nextStatus of nextStatuses) {
        expect(decideRunLifecycleTransition(currentStatus, nextStatus)).toEqual({
          kind: 'skip_terminal',
          terminalStatus: currentStatus,
        });
      }
    }
  });

  it('非终态生命周期写入可以继续应用', () => {
    const activeStatuses: RunStatus[] = ['pending', 'running', 'awaiting_user', 'paused'];

    for (const currentStatus of activeStatuses) {
      expect(decideRunLifecycleTransition(currentStatus, 'completed')).toEqual({ kind: 'apply' });
    }
  });

  it('isRunTerminalStatus 只识别 completed/failed/cancelled', () => {
    expect(isRunTerminalStatus('completed')).toBe(true);
    expect(isRunTerminalStatus('failed')).toBe(true);
    expect(isRunTerminalStatus('cancelled')).toBe(true);
    expect(isRunTerminalStatus('running')).toBe(false);
  });
});
