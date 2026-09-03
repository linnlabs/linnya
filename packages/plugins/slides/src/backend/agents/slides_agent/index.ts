import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { SLIDES_AGENT_ID, SlidesPromptKeys } from '@plugin/slides/shared';
import { SLIDES_AGENT_PROMPT } from './prompt';
import { slidesToolManifest } from '../../toolManifest';

function buildSystemPrompt(): string {
  return buildPrompt(SLIDES_AGENT_PROMPT);
}

function processResponse(rawResponse: string): string {
  return rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function processStreamChunk(chunk: string): string {
  if (chunk.includes('<think>') || chunk.includes('</think>')) return '';
  return chunk;
}

export const SLIDES_AGENT_DEFINITION: AgentDefinition = {
  id: SLIDES_AGENT_ID,
  promptKey: SlidesPromptKeys.SLIDES_AGENT,
  defaultMode: 'agent',
  description: 'PPT 场景专用 SlidesAgent',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    enableTools: true,
    availableTools: slidesToolManifest.agentTools.slidesAgent,
    skill: {
      enabled: true,
      requiredSkills: ['slides-design'],
    },
    knowledgeBaseId: 'default',
    maxSteps: 800,
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    stepPolicy: {
      kind: 'final_answer',
      lastStepsHintThreshold: 12,
    },
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
    responseProcessor: processResponse,
    streamChunkProcessor: processStreamChunk,
  },
};

export default SLIDES_AGENT_DEFINITION;
