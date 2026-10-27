import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import defaultAgent, { buildDefaultAgentSystemPrompt } from '../default';
import { SOURCE_REVIEW_RESPONSIBILITY_PROMPT } from './prompt';

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.DEEP_RESEARCH_SOURCE_REVIEW,
  promptKey: PromptKeys.DEEP_RESEARCH_SOURCE_REVIEW,
  defaultMode: 'agent',
  // 仅保留历史身份与恢复配置，实验结束后不再接纳新的根任务。
  newRunUnavailableReason:
    '此历史研究入口已退役，不再接收新任务。新研究请使用“研究”（research_v1）；已有历史保留，暂停继续仍须通过原运行兼容检查。',
  description: '研究数字与来源校对（内部 CLI）',
  // 原件取得、执行计算与图片能力都走现有 Default 工具，不旁路 owner。
  config: {
    ...defaultAgent.config,
    availableTools: defaultAgent.config.availableTools.filter(name => name !== 'skill_manage'),
  },
  task: {
    systemPromptBuilder: () =>
      `${buildDefaultAgentSystemPrompt()}\n${SOURCE_REVIEW_RESPONSIBILITY_PROMPT}`,
  },
};

export default AGENT_DEFINITION;
