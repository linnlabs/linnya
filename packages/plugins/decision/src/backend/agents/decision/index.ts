import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { DecisionPromptKeys } from '../../../shared';
import { DECISION_SYSTEM_PROMPT } from './prompt';

export const decisionAgent: AgentDefinition = {
  id: DecisionPromptKeys.MAIN,
  promptKey: DecisionPromptKeys.MAIN,
  defaultMode: 'agent',
  description: '决策原型：比较选项、计算取舍，并随条件更新建议',
  config: {
    enableTools: true,
    allowedSubagentTypes: ['decision_research'],
    availableTools: [
      'list_files', 'read_file', 'grep', 'write_file', 'edit_file',
      'skill', 'ask', 'shell', 'process', 'tool_output_read', 'subagent',
      'web_search', 'web_read', 'knowledge_search', 'knowledge_read',
    ],
    skill: { enabled: true, requiredSkills: ['decision-exploration'] },
    maxSteps: 100,
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    stepPolicy: { kind: 'final_answer', lastStepsHintThreshold: 8 },
  },
  task: { systemPromptBuilder: () => DECISION_SYSTEM_PROMPT },
};
