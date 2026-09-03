import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { TranslationSingleTurnAgentTask } from './task';

export const TRANSLATION_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.TRANSLATION,
  promptKey: PromptKeys.TRANSLATION,
  defaultMode: 'agent',
  description: '通用翻译（single_turn）',
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
    customTaskClass: TranslationSingleTurnAgentTask,
  },
};

export default TRANSLATION_SINGLE_TURN_AGENT_DEFINITION;
