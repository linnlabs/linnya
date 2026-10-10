import { isDeepStrictEqual } from 'node:util';
import { RESEARCH_AGENT_ID } from '@app/schemas';
import type { AgentConfiguration, AgentRecoveryIdentity } from '../../types';

// 旧 research_v1 的实际定义：恢复仍消费冻结策略，不能换成当前主 Agent 的能力。
const LEGACY_RESEARCH_HOST_CONFIGURATION: AgentConfiguration = {
  availableTools: [],
  enableTools: false,
  modelPolicy: { kind: 'user_primary' },
};

/** 主 Agent 直接成文以前的完整配置；不能从现行配置派生，否则历史能力会随新代码漂移。 */
export const LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION: AgentConfiguration = {
  availableSubagentTypes: [
    'research_investigation',
    'research_investigation_review',
    'research_draft',
    'research_argument_review',
    'research_source_review',
    'research_revision',
  ],
  availableTools: [
    'list_files',
    'read_file',
    'grep',
    'tool_output_read',
    'knowledge_search',
    'knowledge_read',
    'web_search',
    'web_read',
    'skill',
    'shell',
    'process',
    'task_write',
    'task_read',
    'subagent',
    'complete_research',
  ],
  enableTools: true,
  maxSteps: 800,
  modelPolicy: { kind: 'user_primary' },
  preferredModelCapability: 'tool_calling',
  skill: { enabled: true, requiredSkills: ['deep-research'] },
  contextPolicy: {
    profileId: 'agent',
    toolHistory: { strategy: 'per-run', retentionMode: 'drop', keepLatestRuns: 2 },
    systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
  },
  stepPolicy: { kind: 'final_answer', lastStepsHintThreshold: 12 },
};

/** 只识别已声明的历史身份与完整配置；其它环境兼容性仍由恢复 owner 严格核对。 */
export function resolveLegacyResearchConfiguration(
  identity: AgentRecoveryIdentity
): AgentConfiguration | undefined {
  if (
    !identity.isChild &&
    identity.promptKey === RESEARCH_AGENT_ID &&
    identity.hostToolCall?.tool_name === 'research_run' &&
    identity.hostToolCall.completion_mode === 'yield_after_batch'
  ) {
    return LEGACY_RESEARCH_HOST_CONFIGURATION;
  }
  if (
    !identity.isChild &&
    identity.promptKey === RESEARCH_AGENT_ID &&
    identity.hostToolCall === undefined &&
    isDeepStrictEqual(identity.frozenConfiguration, LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION)
  ) {
    return LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION;
  }
  return undefined;
}
