import type Database from 'better-sqlite3';

import type { ToolContext } from '../../types';
import {
  createSqliteActionLedger,
  currentActionActor,
  resolveToolRunActor,
  type ActionActor,
  type ActionLedgerRecorder,
} from '../../../domains/action-ledger';

/** 文件工具的 Host 粗账端口；执行者取自工具上下文，没有运行编号的上下文不入账。 */
export function createFileToolActionLedger(
  context: ToolContext,
  db: Database.Database
): ActionLedgerRecorder | undefined {
  const actor = resolveFileToolActor(context);
  return actor ? createSqliteActionLedger(db).recorderFor(actor, 'coarse') : undefined;
}

/**
 * 运行里的写入记为运行，只有一种例外：外部控制桥（Linnya CLI）接纳的那次原始 Host 工具调用。
 * 那次运行没有模型，写入的是 CLI 的调用方，记为 external 并带上运行身份。
 * 同一入口发起的模型运行（CLI send）里，模型自己的工具调用仍记为运行；
 * 界面发起的 Host 工具调用（表格填充等）入口身份是 user，也仍记为运行。
 */
function resolveFileToolActor(context: ToolContext): ActionActor | undefined {
  const entry = currentActionActor();
  const run = resolveToolRunActor(context);
  if (!run) return entry;
  const hostCall = context.authorizedHostToolCall;
  const isEntryHostCall = run.kind === 'run'
    && hostCall !== undefined
    && hostCall.toolCallId === context.parentToolCallId;
  return entry?.kind === 'external' && isEntryHostCall ? { kind: 'external', run } : run;
}

/** 可选端口按存在与否展开，避免向 resolver 传入显式 undefined。 */
export function withActionLedger(
  actionLedger: ActionLedgerRecorder | undefined
): { readonly actionLedger?: ActionLedgerRecorder } {
  return actionLedger ? { actionLedger } : {};
}
