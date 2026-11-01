import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

type RunSnapshot = runSupervisor.RunSnapshot;

/** 正在占用执行资源、重启会直接打断的 run 状态。awaiting_user 与已收口 paused 不在其中。 */
export const EXECUTING_RUN_STATUSES = Object.freeze(['pending', 'running'] as const);

export interface ActiveForegroundConversationRuns {
  readonly conversationId: string;
  /** 同一对话正常只有一个；合同异常时保留全部，交给调用方逐个处理而不是丢弃。 */
  readonly runs: readonly RunSnapshot[];
}

/**
 * 前台根 run：没有 parent，且由 Flow 以 `lane=foreground` 接纳。
 * child/subagent 由父链负责收口；标题、补全、翻译等 auxiliary run 不属于用户可见的任务。
 */
export function isForegroundRootRun(run: RunSnapshot): boolean {
  return run.parentRunId === undefined && run.metadata?.lane === 'foreground';
}

function isExecuting(run: RunSnapshot): boolean {
  return run.status === 'pending' || run.status === 'running';
}

/** 按对话聚合正在执行的前台根 run；对话顺序按其最早 run 的启动时间稳定排列。 */
export function selectActiveForegroundRootRuns(
  runs: readonly RunSnapshot[]
): readonly ActiveForegroundConversationRuns[] {
  const byConversation = new Map<string, RunSnapshot[]>();
  const seenRunIds = new Set<string>();
  for (const run of runs) {
    if (!isForegroundRootRun(run) || !isExecuting(run) || seenRunIds.has(run.runId)) continue;
    seenRunIds.add(run.runId);
    const group = byConversation.get(run.conversationId);
    if (group) group.push(run);
    else byConversation.set(run.conversationId, [run]);
  }
  return [...byConversation.entries()]
    .map(([conversationId, group]) => ({
      conversationId,
      runs: [...group].sort((left, right) => left.startedAt - right.startedAt),
    }))
    .sort((left, right) => (left.runs[0]?.startedAt ?? 0) - (right.runs[0]?.startedAt ?? 0));
}
