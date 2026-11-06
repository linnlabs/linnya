import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import type { ActionActor, ActionLedgerEntryInput } from '../definitions/actionLedger';
import { createSqliteActionLedger } from './sqlite/createSqliteActionLedger';

const actors = new AsyncLocalStorage<ActionActor>();

/** 只由 Host 的可信入口绑定；异步操作沿调用继承，交错调用不会共用身份。 */
export function withActionActor<T>(actor: ActionActor, operation: () => T): T {
  return actors.run(actor, operation);
}

export function currentActionActor(): ActionActor | undefined {
  return actors.getStore();
}

export function recordScopedDocumentAction(db: Database.Database, entry: ActionLedgerEntryInput): void {
  const actor = currentActionActor();
  if (actor) createSqliteActionLedger(db).recorderFor(actor, 'coarse').record(entry);
}
