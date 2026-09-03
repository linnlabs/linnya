import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition } from '../../../types';
import { AutocompleteOptionsExtender } from 'src/app-hosts/linnya/adapters/flow/history-builder/extenders/autocomplete-options.extender';
import { AutocompleteSingleTurnAgentTask } from './task';

export const AUTOCOMPLETE_SINGLE_TURN_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.AUTOCOMPLETE,
  promptKey: PromptKeys.AUTOCOMPLETE,
  defaultMode: 'agent',
  description: '自动补全（single_turn）',
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
    customTaskClass: AutocompleteSingleTurnAgentTask,
  },
  integrations: {
    historyBuilderExtenders: [() => new AutocompleteOptionsExtender()],
  },
};

export default AUTOCOMPLETE_SINGLE_TURN_AGENT_DEFINITION;
