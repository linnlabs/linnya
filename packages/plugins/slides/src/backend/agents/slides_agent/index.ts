import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { SLIDES_AGENT_ID, SlidesPromptKeys } from '@plugin/slides/shared';
import { SLIDES_AGENT_PROMPT } from './prompt';
import { slidesToolManifest } from '../../toolManifest';
import { SLIDES_CONTEXT_POLICY, SLIDES_FINALIZATION_STEPS } from './executionPolicy';

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
    contextPolicy: SLIDES_CONTEXT_POLICY,
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
      lastStepsHintThreshold: SLIDES_FINALIZATION_STEPS,
    },
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
    responseProcessor: processResponse,
    streamChunkProcessor: processStreamChunk,
  },
};

export default SLIDES_AGENT_DEFINITION;
