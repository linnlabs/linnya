import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { ConversationTitleSingleTurnAgentTask } from './task';

export const CONVERSATION_TITLE_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.CONVERSATION_TITLE,
  promptKey: PromptKeys.CONVERSATION_TITLE,
  defaultMode: 'agent',
  description: '新对话自动标题（single_turn）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-pair', keepLatestToolPairs: 0 },
    },
    enableTools: false,
    availableTools: [],
    modelPolicy: { kind: 'user_auxiliary' },
    preferredModelCapability: 'chat',
  },
  task: {
    customTaskClass: ConversationTitleSingleTurnAgentTask,
  },
};

export default CONVERSATION_TITLE_SINGLE_TURN_AGENT_DEFINITION;
