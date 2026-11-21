import { isRetiredDeepResearchAgentId } from '@app/schemas';
import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';

const RETIRED_AGENT_NEW_RUN_REASON =
  '旧版深度研究已退役，不再接收新任务；历史对话仍可查看。新研究请使用“研究”。';

/** 只用于首次接纳；恢复必须保留原 descriptor，不能把已停用入口改成其它 Agent。 */
export function assertAgentNewRunAvailable(promptKey: string): void {
  if (isRetiredDeepResearchAgentId(promptKey)) {
    throw new AgentNewRunUnavailableError(RETIRED_AGENT_NEW_RUN_REASON);
  }
  const reason = findRegisteredAgentDefinitionByPromptKey(promptKey)?.newRunUnavailableReason;
  if (reason !== undefined) throw new AgentNewRunUnavailableError(reason);
}

export class AgentNewRunUnavailableError extends Error {
  readonly code = 'AGENT_NEW_RUN_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AgentNewRunUnavailableError';
  }
}

/**
 * 已退役 Agent 的暂停或待审批运行在继续/响应时被明确终止。
 * 历史事实与已保存文档保留；不切换到其它 Agent 续跑。
 */
export class RetiredAgentRunTerminatedError extends Error {
  readonly code = 'AGENT_RETIRED';
  constructor() {
    super(
      '旧版深度研究已退役，这次暂停的运行已终止。历史对话和已保存的文档仍保留；如需继续研究，请选择“研究”发起新任务。'
    );
    this.name = 'RetiredAgentRunTerminatedError';
  }
}
