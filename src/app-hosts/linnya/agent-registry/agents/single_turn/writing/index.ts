import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { WritingSingleTurnAgentTask } from './task';

export const WRITING_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.WRITING,
  promptKey: PromptKeys.WRITING,
  defaultMode: 'agent',
  description: '编辑器写作/续写（single_turn）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-pair', keepLatestToolPairs: 0 },
    },
    enableTools: false,
    availableTools: [],
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'chat',
  },
  task: {
    customTaskClass: WritingSingleTurnAgentTask,
  },
};

export default WRITING_SINGLE_TURN_AGENT_DEFINITION;
