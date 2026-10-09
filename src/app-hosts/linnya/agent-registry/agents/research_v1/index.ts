import type { AgentDefinition } from '../../types';
import { resolveResearchAdmission } from './admission';

/** 工程入口只交给 Host 执行；不产生另一个会规划/扩张流程的 Leader。 */
export default {
  id: 'research_v1',
  promptKey: 'research_v1',
  defaultMode: 'agent',
  description: '研究（工程预览）：调查、独立复核与一次修订',
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
