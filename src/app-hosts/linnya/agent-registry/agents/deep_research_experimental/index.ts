import type { AgentSpecSystemReminderPolicy } from '@linnlabs/linnkit/contracts';
import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import defaultAgent, { buildDefaultAgentSystemPrompt } from '../default';
import { LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY } from '../systemReminder';
import { RESEARCH_RESPONSIBILITY_PROMPT } from './prompt';

const researchReminderId = 'linnya_periodic_research_reflection';
export const RESEARCH_SYSTEM_REMINDER_POLICY: AgentSpecSystemReminderPolicy = {
  ...LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY,
  enabledRuleIds: [
    ...(LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY.enabledRuleIds ?? []),
    researchReminderId,
  ],
  extraRules: [
    ...(LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY.extraRules ?? []),
    {
      id: researchReminderId,
      trigger: { kind: 'step-count-modulo', period: 30, minStep: 30 },
      contentTemplate: 'hostReminderText',
      contentArgs: {
        lines: [
          '回到当前研究问题和已加载的方法：现有证据能区分哪些解释，最重要的缺口是什么？',
          '下一步选择能改变解释的补查、推理或当前阶段交付；不要为凑来源重复搜索。',
          '若正在修订，核对反馈是否有依据，以及相关正文是否已同步；更新紧凑记录后继续。',
        ],
      },
    },
  ],
};

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.DEEP_RESEARCH_EXPERIMENTAL,
  promptKey: PromptKeys.DEEP_RESEARCH_EXPERIMENTAL,
  defaultMode: 'agent',
  description: '研究行为实验 Agent（CLI）',
  // 同工具、模型路由、步数与上下文策略：只改变研究职责和短提醒，便于对照。
  config: {
    ...defaultAgent.config,
    availableTools: defaultAgent.config.availableTools.filter(name => name !== 'skill_manage'),
    // requiredSkills 当前校验插件随包根；内置Skill使用正式catalog，仍须实际激活。
    skill: defaultAgent.config.skill,
    contextPolicy: {
      ...defaultAgent.config.contextPolicy,
      systemReminder: RESEARCH_SYSTEM_REMINDER_POLICY,
    },
  },
  task: {
    systemPromptBuilder: () =>
      `${buildDefaultAgentSystemPrompt()}\n${RESEARCH_RESPONSIBILITY_PROMPT}`,
  },
};

export default AGENT_DEFINITION;
