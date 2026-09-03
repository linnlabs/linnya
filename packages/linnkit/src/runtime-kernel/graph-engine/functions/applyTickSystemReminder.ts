import type { LlmRequestMessage } from '../../../ports';
import { applySystemReminders } from '../../system-reminder/apply';
import type { ExecutorLocalState } from '../types';
import type { AgentInvocationRequest } from '../../../ports';
import type { RuntimeEvent } from '../../../contracts';

export function applyTickSystemReminder(input: {
  llmMessages: readonly LlmRequestMessage[];
  request: AgentInvocationRequest;
  history: readonly RuntimeEvent[];
  executorLocal?: ExecutorLocalState;
}): { llmMessages: LlmRequestMessage[]; hitRuleIds?: string[] } {
  let hitRuleIds: string[] | undefined;
  const llmMessages = applySystemReminders({
    llmMessages: [...input.llmMessages],
    ctx: {
      request: input.request,
      history: [...input.history],
      executorLocal: input.executorLocal,
    },
    policy: input.executorLocal?.systemReminderPolicy,
    onInjected: ({ ruleIds }) => {
      hitRuleIds = Array.isArray(ruleIds) ? ruleIds : [];
    },
  });
  return { llmMessages, ...(hitRuleIds ? { hitRuleIds } : {}) };
}
