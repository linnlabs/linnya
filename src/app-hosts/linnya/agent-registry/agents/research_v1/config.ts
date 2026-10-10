import type { AgentConfiguration } from '../../types';

export const RESEARCH_ROLE_ROOT_UNAVAILABLE_REASON =
  '这是供 subagent 委派的专项研究角色；请从主 Agent 发起具体任务，不能单独发起根运行。';

/** 专项角色不再委派；文档职责由请求明确，通用文件工具不实施研究权限。 */
export const RESEARCH_ROLE_CONFIG_V1 = {
  availableTools: [
    'list_files',
    'read_file',
    'write_file',
    'edit_file',
    'grep',
    'tool_output_read',
    'knowledge_search',
    'knowledge_read',
    'web_search',
    'web_read',
    'skill',
    'shell',
    'process',
  ],
  enableTools: true,
  knowledgeBaseId: 'default',
  maxSteps: 800,
  modelPolicy: { kind: 'inherit_parent' },
  preferredModelCapability: 'tool_calling',
  skill: { enabled: true, requiredSkills: ['deep-research'] },
  contextPolicy: {
    profileId: 'agent',
    toolHistory: { strategy: 'per-run', retentionMode: 'drop', keepLatestRuns: 2 },
    // 只保留运行预算收尾；不注入 Default 的 TaskState 或周期研究提醒。
    systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
  },
  // 普通终答报告实际保存结果；预算耗尽也允许如实说明未完成。
  stepPolicy: { kind: 'final_answer', lastStepsHintThreshold: 3 },
} satisfies AgentConfiguration;
