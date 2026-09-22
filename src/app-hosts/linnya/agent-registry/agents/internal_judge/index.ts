import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { INTERNAL_JUDGE_PROMPT } from './prompt';

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.INTERNAL_JUDGE,
  promptKey: PromptKeys.INTERNAL_JUDGE,
  defaultMode: 'agent',
  description: 'Internal document judge; CLI entry, no composer menu contribution.',
  config: {
    enableTools: true,
    availableTools: ['list_files', 'read_file', 'write_file', 'tool_output_read', 'skill', 'judge_record'],
    skill: { enabled: true },
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    maxSteps: 160,
  },
  task: { systemPromptBuilder: () => INTERNAL_JUDGE_PROMPT },
};
export default AGENT_DEFINITION;
