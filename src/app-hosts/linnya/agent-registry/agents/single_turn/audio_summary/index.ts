import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { AudioSummarySingleTurnAgentTask } from './task';

export const AUDIO_SUMMARY_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.AUDIO_SUMMARY,
  promptKey: PromptKeys.AUDIO_SUMMARY,
  defaultMode: 'agent',
  description: '音频转录纪要/摘要（single_turn）',
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
    customTaskClass: AudioSummarySingleTurnAgentTask,
  },
};

export default AUDIO_SUMMARY_SINGLE_TURN_AGENT_DEFINITION;
