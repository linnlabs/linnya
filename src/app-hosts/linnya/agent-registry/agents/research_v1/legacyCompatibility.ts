import { RESEARCH_AGENT_ID } from '@app/schemas';
import type { AgentConfiguration, AgentRecoveryIdentity } from '../../types';

// 旧 research_v1 的实际定义：恢复仍消费冻结策略，不能换成当前主 Agent 的能力。
const LEGACY_RESEARCH_HOST_CONFIGURATION: AgentConfiguration = {
  availableTools: [],
  enableTools: false,
  modelPolicy: { kind: 'user_primary' },
};

/** 只声明可继续提供的旧 Host 根身份；完整配置和环境校验仍归恢复 owner。 */
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
  return undefined;
}
