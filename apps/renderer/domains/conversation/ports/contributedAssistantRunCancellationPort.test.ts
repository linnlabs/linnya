import { describe, expect, it, vi } from 'vitest';
import {
  cancelContributedAssistantRuns,
  registerContributedAssistantRunCancellation,
} from './contributedAssistantRunCancellationPort';

describe('contributedAssistantRunCancellationPort', () => {
  it('只通知当前已注册的外部 run', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerContributedAssistantRunCancellation(first);
    const unregisterSecond = registerContributedAssistantRunCancellation(second);

    unregisterFirst();
    cancelContributedAssistantRuns();
    unregisterSecond();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
