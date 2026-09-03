import { applyTickSystemReminder } from '../../functions/applyTickSystemReminder';
import { defineTickStage } from '../types';
import type { TickStage } from '../types';

export function createApplySystemReminderStage(): TickStage {
  return defineTickStage({
    id: 'apply_system_reminder',
    reads: ['llmMessages', 'request', 'history', 'executorLocal'],
    writes: ['systemReminderHitRuleIds', 'llmMessages'],
    async run(ctx) {
      const result = applyTickSystemReminder({
        llmMessages: ctx.llmMessages,
        request: ctx.request,
        history: ctx.history,
        executorLocal: ctx.executorLocal,
      });

      return {
        systemReminderHitRuleIds: result.hitRuleIds,
        llmMessages: result.llmMessages,
      };
    },
  });
}
