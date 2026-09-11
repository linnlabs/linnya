import type Database from 'better-sqlite3';
import type { execution } from '@linnlabs/linnkit/runtime-kernel';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { SQLiteEventStore } from '../event-store';
import { SqliteCheckpointer } from '../checkpointer';
import { SQLiteRunRegistryStore } from '../run-registry';
import { SqliteRunDescriptorStore } from '../run-descriptors';

export type CheckpointWriter = NonNullable<
  execution.EventBusEventPersistenceOptions['checkpointWriter']
>;

/** 同一连接的 owner adapter；不把 SQLite 事务或数据库句柄传入 Graph。 */
export class SqliteExecutionCommit {
  private readonly events: SQLiteEventStore;
  private readonly checkpoints: SqliteCheckpointer;
  private readonly runs: SQLiteRunRegistryStore;
  private readonly descriptors: SqliteRunDescriptorStore;

  constructor(private readonly db: Database.Database) {
    this.events = new SQLiteEventStore(db);
    this.checkpoints = new SqliteCheckpointer(db);
    this.runs = new SQLiteRunRegistryStore(db);
    this.descriptors = new SqliteRunDescriptorStore(db);
  }

  forExecution(runId: string, executionId: string): CheckpointWriter {
    return async ({ checkpointKey, checkpoint, events }) => {
      this.db.transaction(() => {
        if (checkpointKey !== runId)
          throw new Error('Execution checkpoint key differs from run identity');
        const run = this.runs.requireExecutionOwner(runId, executionId);
        const session = { runId, conversationId: run.conversationId, startedAt: run.startedAt };
        for (const persisted of events) {
          this.events.appendEventInTransaction(session, persisted.event, {
            eventStoreId: graph.requireEventStoreId(persisted.eventStoreId),
          });
        }
        this.checkpoints.saveInTransaction(checkpointKey, checkpoint);
        this.descriptors.markCheckpointCommittedInTransaction(runId);
      })();
    };
  }
}
