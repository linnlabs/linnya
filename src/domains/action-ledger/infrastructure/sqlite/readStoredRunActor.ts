import type Database from 'better-sqlite3';
import type { ActionRunActor } from '../../definitions/actionLedger';
import { resolveToolRunActor } from '../../functions/resolveToolRunActor';

const MAX_DEPTH = 64;

/**
 * 只拿到运行编号的入口（Shell 里的 `linnya` 命令）按运行记录找出父运行和根运行。
 * 编号来自 Host 冻结的执行身份，不来自命令参数。没有运行表或找不到运行时返回空，
 * 调用方按外部入口记账；链条中断时报错，不按父运行猜根运行。
 */
export function readStoredRunActor(db: Database.Database, runId: string, conversationId: string | null): ActionRunActor | undefined {
  const hasRuns = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
  if (!hasRuns) return undefined;
  const select = db.prepare<[string], { parent_run_id: string | null }>('SELECT parent_run_id FROM runs WHERE id = ?');
  const first = select.get(runId);
  if (!first) return undefined;
  let rootRunId = runId;
  let parent = first.parent_run_id;
  for (let depth = 0; parent; depth += 1) {
    if (depth >= MAX_DEPTH) throw new Error(`运行 ${runId} 的父运行链过长`);
    const row = select.get(parent);
    if (!row) throw new Error(`运行 ${runId} 的父运行 ${parent} 不存在，不能确定根运行`);
    rootRunId = parent;
    parent = row.parent_run_id;
  }
  return resolveToolRunActor({
    runId,
    rootRunId,
    ...(first.parent_run_id ? { parentRunId: first.parent_run_id } : {}),
    ...(conversationId ? { conversationId } : {}),
  });
}
