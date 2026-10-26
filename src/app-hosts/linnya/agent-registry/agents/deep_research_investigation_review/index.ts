import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import defaultAgent, { buildDefaultAgentSystemPrompt } from '../default';
import { INVESTIGATION_REVIEW_RESPONSIBILITY_PROMPT } from './prompt';

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.DEEP_RESEARCH_INVESTIGATION_REVIEW,
  promptKey: PromptKeys.DEEP_RESEARCH_INVESTIGATION_REVIEW,
  defaultMode: 'agent',
  // 仅保留历史身份与恢复配置，实验结束后不再接纳新的根任务。
  newRunUnavailableReason:
    '此历史研究入口已退役，不再接收新任务。新研究请使用“研究”（research_v1）；已有历史保留，暂停继续仍须通过原运行兼容检查。',
  description: '研究调查复核（内部 CLI）',
  // 分工只改变职责；工具、预算、模型和提醒与通用审核的 Default 底座一致。
  config: defaultAgent.config,
  task: {
    systemPromptBuilder: () =>
      `${buildDefaultAgentSystemPrompt()}\n${INVESTIGATION_REVIEW_RESPONSIBILITY_PROMPT}`,
  },
};

export default AGENT_DEFINITION;
