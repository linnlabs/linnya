export const BACKEND_APP_ACTIVITY_READ_RPC_METHOD = 'backend.app_activity.read' as const;
export const BACKEND_APP_ACTIVITY_PAUSE_AGENT_RUNS_RPC_METHOD =
  'backend.app_activity.pause_agent_runs' as const;
/**
 * 暂停要等每个 execution 收口（与 HTTP pause 相同），可能超过通用 30s RPC deadline。
 * 超时只结算 Desktop 调用方；Backend 侧暂停继续完成，不会因此取消任何运行。
 */
export const APP_SERVER_PAUSE_AGENT_RUNS_TIMEOUT_MS = 120_000;

export interface AppServerActiveAgentRun {
  readonly conversationId: string;
  readonly conversationTitle: string | null;
}

export interface AppServerActivitySnapshot {
  readonly hasExecutingCommands: boolean;
  /** 每个对话最多一项：pending/running 的前台根 run。 */
  readonly activeAgentRuns: readonly AppServerActiveAgentRun[];
  readonly knowledgeIngestionActive: boolean;
}

export interface AppServerPauseAgentRunsResult {
  readonly pausedConversationIds: readonly string[];
  /** 没有可恢复输入等原因无法暂停的对话；重启会直接中断它们。 */
  readonly unpausableConversationIds: readonly string[];
}

export interface AppServerActivityGatewayPort {
  read(): Promise<AppServerActivitySnapshot>;
  pauseAgentRuns(): Promise<AppServerPauseAgentRunsResult>;
}

/** App Server 侧的活动来源；Agent runtime 尚未注册时返回空列表，而不是报错。 */
export interface AppServerActivitySourcePort {
  hasExecutingCommands(): boolean;
  hasActiveKnowledgeIngestion(): boolean;
  listActiveAgentRuns(): Promise<readonly AppServerActiveAgentRun[]>;
  pauseActiveAgentRuns(): Promise<AppServerPauseAgentRunsResult>;
}
