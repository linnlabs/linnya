import type { AgentConfiguration } from '../../types';

/**
 * 四职责共享只读 Workspace 能力。产物由 Host 保存，不能靠 reviewer 自律保证正文不被覆盖。
 * Shell 仍有宿主命令能力，此白名单不是操作系统或整个项目的权限沙箱。
 */
export const RESEARCH_ROLE_CONFIG_V1 = {
  availableTools: [
    'list_files', 'read_file', 'grep', 'tool_output_read',
    'knowledge_search', 'knowledge_read', 'web_search', 'web_read',
    'skill', 'shell', 'process',
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
} satisfies AgentConfiguration;
