import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

type RunIdentity = Pick<
  runSupervisor.RunRecord,
  'runId' | 'parentRunId' | 'conversationId' | 'status'
>;

export function isTerminalRun(run: RunIdentity): boolean {
  return run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed';
}

/** 子结果直到根运行结算才可释放；不能只保留 status=paused 的行。 */
export function selectRunTree<T extends RunIdentity>(runs: readonly T[], rootId: string): T[] {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      if (run.parentRunId && ids.has(run.parentRunId) && !ids.has(run.runId)) {
        ids.add(run.runId);
        changed = true;
      }
    }
  }
  return runs.filter(run => ids.has(run.runId));
}

export function selectRunRecoveryRetention(runs: readonly RunIdentity[]) {
  const retained = runs
    .filter(run => !run.parentRunId && !isTerminalRun(run))
    .flatMap(root => selectRunTree(runs, root.runId));
  return {
    checkpointKeys: retained.map(run => run.runId),
    // 后续步骤可能续读原对话历史里的 blob，故文本产物按对话保留，不只按当前 tool call。
    conversationIds: new Set(retained.map(run => run.conversationId)),
  };
}
