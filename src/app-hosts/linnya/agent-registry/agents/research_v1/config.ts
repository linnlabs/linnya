import type { AgentConfiguration } from '../../types';

export const RESEARCH_ROLE_ROOT_UNAVAILABLE_REASON =
  '这是研究流程的内部阶段，须由 research_v1 接纳任务并绑定材料与保存位置；不能单独发起根运行。';

/**
 * 四职责仅能读取 Workspace，并提交 Host 已冻结的新产物；不能覆盖作者或同伴的文稿。
 * Shell 仍有宿主命令能力，此白名单不是操作系统或整个项目的权限沙箱。
 */
export const RESEARCH_ROLE_CONFIG_V1 = {
  availableTools: [
    'list_files', 'read_file', 'grep', 'tool_output_read',
    'knowledge_search', 'knowledge_read', 'web_search', 'web_read',
    'skill', 'shell', 'process', 'submit_research_document',
  ],
  resultToolName: 'submit_research_document',
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
  // 保存校验必须发生在 child 结束前，错误才能回到原模型并在原预算内修正。
  stepPolicy: {
    kind: 'force_tools',
    forcedTools: ['submit_research_document'],
    lastStepsHintThreshold: 3,
  },
} satisfies AgentConfiguration;
