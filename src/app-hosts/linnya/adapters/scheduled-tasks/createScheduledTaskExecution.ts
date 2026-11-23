import { generateConversationId } from '@linnlabs/linnkit/contracts';
import { ConversationSelectedAgentIdSchema, PromptKeys, RESEARCH_AGENT_ID, ScheduledAgentIds } from '@app/schemas';
import type { ConversationControlFlowPort } from '../../application/conversation-control';
import type { ConversationCommandPermissions } from '../../application/conversation-command-permissions';
import { readConversationActivities, type ConversationActivityPorts } from '../../application/conversation-activity';
import type { ScheduledExecutionFact, ScheduledTaskExecutionPort } from '../../application/scheduled-tasks';
import type { HistoryService } from 'src/features/conversation/history/history.service';

export function createScheduledTaskExecution(input: {
  flow: Pick<ConversationControlFlowPort, 'start' | 'stop'>;
  history: Pick<HistoryService, 'updateConversationSelectedAgent'>;
  permissions: Pick<ConversationCommandPermissions, 'initializeForNewConversation'>;
  activity: ConversationActivityPorts;
}): ScheduledTaskExecutionPort {
  return {
    async start(task, run, modelId, prepared) {
      if (run.started_at === null) throw new Error('Scheduled run has no start time');
      const conversationId = generateConversationId();
      const agent = task.agent === 'default' ? PromptKeys.DEFAULT : RESEARCH_AGENT_ID;
      // 初始化档位同时让新对话落库。已存在的对话会被权限 owner 拒绝。
      await input.permissions.initializeForNewConversation({ conversation_id: conversationId, project_id: task.project_id }, task.permission_level);
      const updated = await input.history.updateConversationSelectedAgent(conversationId, ConversationSelectedAgentIdSchema.parse(agent), task.project_id);
      if (!updated) throw new Error(`Unable to save Agent for scheduled conversation ${conversationId}`);
      prepared(conversationId);
      const receipt = await input.flow.start({
        conversation_id: conversationId,
        project_id: task.project_id,
        new_events: [{ type: 'user_input', content: task.prompt, timestamp: run.started_at, source: 'system' }],
        options: {
          model_id: modelId,
          selected_agent_id: ConversationSelectedAgentIdSchema.parse(ScheduledAgentIds[task.agent]),
          project_metadata: { id: task.project_id },
          run_lane: 'foreground',
          event_visibility: 'conversation',
          scheduled_run: { task_id: task.id, task_run_id: run.id, planned_at: run.planned_at },
        },
      });
      return receipt.runId;
    },
    async read(runs) {
      if (runs.length === 0) return new Map();
      const ids = runs.flatMap(run => run.conversation_id ? [run.conversation_id] : []);
      const activities = await readConversationActivities(input.activity, ids);
      return new Map<string, ScheduledExecutionFact>(runs.map(run => {
        const activity = run.conversation_id ? activities[run.conversation_id] : undefined;
        if (!activity?.run_id || (run.run_id && run.run_id !== activity.run_id)) return [run.id, { state: 'missing', runId: null }];
        if (activity.run_status === 'completed' || activity.run_status === 'failed') return [run.id, { state: activity.run_status, runId: activity.run_id }];
        // Flow 会保留可恢复的 Provider/工具错误给交互式会话；定时历史应把这次尝试记为失败。
        const pauseReason = activity.pause?.reason;
        if (activity.pause?.settled && (pauseReason?.startsWith('llm.') || pauseReason?.startsWith('tool.'))) {
          return [run.id, { state: 'failed', runId: activity.run_id }];
        }
        const state = activity.state === 'awaiting_approval' || activity.state === 'awaiting_answer' || activity.state === 'interrupted'
          ? activity.state : 'running';
        return [run.id, { state, runId: activity.run_id }];
      }));
    },
    async stop(conversationId, runId, reason) { await input.flow.stop(runId, conversationId, reason); },
  };
}
