import type Database from 'better-sqlite3';

import type { ToolContext } from '../../types';
import {
  createSqliteActionLedger,
  currentActionActor,
  resolveToolRunActor,
  type ActionLedgerRecorder,
} from '../../../domains/action-ledger';

/** 文件工具的 Host 粗账端口；执行者取自工具上下文，没有运行编号的上下文不入账。 */
export function createFileToolActionLedger(
  context: ToolContext,
  db: Database.Database
): ActionLedgerRecorder | undefined {
  const actor = resolveToolRunActor(context) ?? currentActionActor();
  return actor ? createSqliteActionLedger(db).recorderFor(actor, 'coarse') : undefined;
}

/** 可选端口按存在与否展开，避免向 resolver 传入显式 undefined。 */
export function withActionLedger(
  actionLedger: ActionLedgerRecorder | undefined
): { readonly actionLedger?: ActionLedgerRecorder } {
  return actionLedger ? { actionLedger } : {};
}
