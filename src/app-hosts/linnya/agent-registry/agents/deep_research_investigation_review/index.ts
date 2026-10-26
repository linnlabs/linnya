import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import defaultAgent, { buildDefaultAgentSystemPrompt } from '../default';
import { INVESTIGATION_REVIEW_RESPONSIBILITY_PROMPT } from './prompt';

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.DEEP_RESEARCH_INVESTIGATION_REVIEW,
  promptKey: PromptKeys.DEEP_RESEARCH_INVESTIGATION_REVIEW,
  defaultMode: 'agent',
  description: '研究调查复核（内部 CLI）',
  // 分工只改变职责；工具、预算、模型和提醒与通用审核的 Default 底座一致。
  config: {
    ...defaultAgent.config,
    availableTools: defaultAgent.config.availableTools.filter(name => name !== 'skill_manage'),
  },
  task: {
    systemPromptBuilder: () =>
      `${buildDefaultAgentSystemPrompt()}\n${INVESTIGATION_REVIEW_RESPONSIBILITY_PROMPT}`,
  },
};

export default AGENT_DEFINITION;
