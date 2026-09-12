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
        const run = this.runs.requireCheckpointExecutionOwner(runId, executionId);
        if (run.status === 'cancelled') {
          const previous = this.checkpoints.loadInTransaction(checkpointKey);
          // Supervisor 先撤销动作权限，Graph 随后收尾。取消时队列中可能已有一个 ready/executing
          // 提交：原 activation 可沿现存 revision 链排空到 yielded，但不能覆盖终止边界或复活断点。
          // 这里只允许事实/位置落盘；工具效果仍必须通过 requireExecutionOwner，取消后始终拒绝。
          if (!previous || previous.executionStatus === 'yielded'
            || checkpoint.revision !== (previous.revision ?? 0) + 1
            || (checkpoint.executionStatus === 'yielded'
              && ((checkpoint.local?.pendingToolCalls?.length ?? 0) !== 0
                || checkpoint.local?.executingToolCallId !== undefined))) {
            throw new Error(`[SqliteExecutionCommit] execution ${executionId} no longer owns run ${runId}: invalid cancellation settlement boundary`);
          }
        }
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
