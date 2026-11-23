import { PromptKeys, ScheduledAgentIds } from '@app/schemas';
import { AgentRequestAdmissionError } from '../../agentRequestAdmissionError';
import type { AgentDefinition } from '../../types';
import defaultAgent from '../default';
import researchAgent from '../research_v1';

export function deriveUnattendedAgent(base: AgentDefinition): AgentDefinition {
  const id = base.id === PromptKeys.DEFAULT ? ScheduledAgentIds.default : ScheduledAgentIds.research;
  const availableTools = base.config?.availableTools;
  const buildPrompt = base.task?.systemPromptBuilder;
  if (!availableTools || !buildPrompt) throw new Error(`Scheduled Agent ${id} requires an explicit tool list and prompt builder`);
  return {
    ...base,
    id,
    promptKey: id,
    requestAdmission(request, context) {
      if (!request.scheduledRun) throw new AgentRequestAdmissionError('SCHEDULED_ENTRY_REQUIRED', 'This Agent requires a scheduled run.');
      return base.requestAdmission ? base.requestAdmission(request, context) : request;
    },
    config: { ...base.config, availableTools: availableTools.filter(tool => tool !== 'ask' && tool !== 'skill_manage') },
    task: {
      ...base.task,
      systemPromptBuilder(request) {
        const run = request.scheduledRun;
        if (!run) throw new Error('Scheduled run metadata is missing from the admitted request');
        return `${buildPrompt(request)}\n\n## Unattended scheduled run\n`
          + `Planned time: ${new Date(run.planned_at).toISOString()}. Actual start: ${new Date(run.started_at).toISOString()}.\n`
          + 'No user is available to answer questions. State the assumptions you make, then continue with the task. '
          + 'During this run, the Linnya schedules CLI cannot create or change scheduled tasks.';
      },
    },
  };
}

export const scheduledDefaultAgent = deriveUnattendedAgent(defaultAgent);
export const scheduledResearchAgent = deriveUnattendedAgent(researchAgent);
