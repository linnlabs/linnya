// === 共享层（agent/chat 之间共用的契约与工具） ===
export * from './shared';

// === 命名空间导出（保留强分层信号，便于 deep navigation） ===
export * as agentContracts from './profiles/agent/contracts';
export * as agentConfig from './profiles/agent/config';
export * as agentContext from './profiles/agent/context';
export * as agentOrchestration from './profiles/agent/orchestration';
export * as agentPreprocessors from './profiles/agent/preprocessors';
export * as agentTasks from './profiles/agent/tasks';
export * as agentTools from './profiles/agent/tools';
export * as agentUtils from './profiles/agent/utils';

// === 扁平 re-export（被消费方实际使用的公开符号） ===
// 显式列出而非 `export *`，避免 agent/chat profile 之间潜在同名冲突。
// 命名上保持源符号名 1:1。
export { AGENT_CONSTANTS } from './profiles/agent/config';
export { AGENT_CONTEXT_BUILDER_CONFIG } from './profiles/agent/context/config';
export { BaseContextProvider } from './profiles/agent/context/providers/base';
export type {
  IContextProvider,
  MessageProcessingState,
  ProviderContext,
  ProviderResult,
} from './profiles/agent/context/providers/base';
export type {
  IContextProvider as SharedContextProvider,
  ProviderContext as SharedProviderContext,
} from './shared/providers';

export type {
  ChatMessage,
  MessageRole,
  MessageType,
} from './shared/contracts/chatLineMessage';
