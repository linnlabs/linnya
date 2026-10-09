import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { RESEARCH_ROLE_CONFIG_V1, RESEARCH_ROLE_ROOT_UNAVAILABLE_REASON } from '../research_v1/config';
import { RESEARCH_ROLE_PROMPT_V1 } from '../research_v1/prompt';
import { RESEARCH_SOURCE_REVIEW_PROMPT_V1 } from './prompt';

export const AGENT_DEFINITION = {
  id: PromptKeys.RESEARCH_SOURCE_REVIEW_V1,
  promptKey: PromptKeys.RESEARCH_SOURCE_REVIEW_V1,
  defaultMode: 'agent',
  description: '受控研究 v1：来源与数值复核',
  newRunUnavailableReason: RESEARCH_ROLE_ROOT_UNAVAILABLE_REASON,
  config: RESEARCH_ROLE_CONFIG_V1,
  task: { systemPromptBuilder: () => `${RESEARCH_ROLE_PROMPT_V1}\n\n${RESEARCH_SOURCE_REVIEW_PROMPT_V1}` },
} satisfies AgentDefinition;

export default AGENT_DEFINITION;
