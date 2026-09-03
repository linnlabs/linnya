import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { AnnotationSingleTurnAgentTask } from './task';

export const ANNOTATION_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.ANNOTATION,
  promptKey: PromptKeys.ANNOTATION,
  defaultMode: 'agent',
  description: '文档批注（single_turn）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-pair', keepLatestToolPairs: 0 },
    },
    enableTools: false,
    availableTools: [],
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'chat',
  },
  task: {
    customTaskClass: AnnotationSingleTurnAgentTask,
  },
};

export default ANNOTATION_SINGLE_TURN_AGENT_DEFINITION;
