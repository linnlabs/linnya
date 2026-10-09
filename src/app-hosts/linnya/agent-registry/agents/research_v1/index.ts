import type { AgentDefinition } from '../../types';
import { resolveResearchAdmission } from './admission';
import { RESEARCH_AGENT_ID } from '@app/schemas';

/** 产品入口交给 Host 执行；不产生另一个会规划/扩张流程的 Leader。 */
export default {
  id: RESEARCH_AGENT_ID,
  promptKey: RESEARCH_AGENT_ID,
  defaultMode: 'agent',
  description: '研究：调查、独立复核与一次修订',
  config: { availableTools: [], enableTools: false, modelPolicy: { kind: 'user_primary' } },
  task: {
    systemPromptBuilder: () =>
      'Research execution is owned by the Host. No model planning is required at this entry.',
  },
  hostEntry: {
    toolName: 'research_run',
    resolveArgs: resolveResearchAdmission,
  },
} satisfies AgentDefinition;
