import type Database from 'better-sqlite3';
import type {
  RunAdmissionCommitPort,
  RunAdmissionFacts,
} from '../../../application/run-resumption';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { SQLiteRunRegistryStore } from '../run-registry';
import { SqliteRunDescriptorStore } from '../run-descriptors';
import { SQLiteEventStore } from '../event-store';

export class SqliteRunAdmissionCommit implements RunAdmissionCommitPort {
  private readonly runs: SQLiteRunRegistryStore;
  private readonly descriptors: SqliteRunDescriptorStore;
  private readonly events: SQLiteEventStore;
  constructor(private readonly db: Database.Database) {
    this.runs = new SQLiteRunRegistryStore(db);
    this.descriptors = new SqliteRunDescriptorStore(db);
    this.events = new SQLiteEventStore(db);
  }

  async start(input: Parameters<RunAdmissionCommitPort['start']>[0]): Promise<void> {
    this.db.transaction(() => {
      if (
        input.replacement &&
        !this.runs.compareAndSwapInTransaction(input.replacement.previous, input.replacement.next)
      ) {
        throw new Error('Paused replacement admission conflict');
      }
      this.runs.saveInTransaction(input.record);
      this.descriptors.insertInTransaction(input.descriptor);
      this.commitFacts(input.record, input.incoming);
    })();
  }

  async resume(input: Parameters<RunAdmissionCommitPort['resume']>[0]): Promise<void> {
    this.db.transaction(() => {
      if (!this.runs.compareAndSwapInTransaction(input.previous, input.next))
        throw new Error('Interaction activation conflict');
      this.commitFacts(input.next, input.incoming);
    })();
  }

  private commitFacts(record: runSupervisor.RunRecord, incoming: RunAdmissionFacts): void {
    const session = {
      runId: record.runId,
      conversationId: record.conversationId,
      startedAt: record.startedAt,
    };
    if (incoming.replaceTargetId) {
      const event = incoming.events[0];
      if (incoming.events.length !== 1 || !event || event.type !== 'user_input')
        throw new Error('Replacement requires one user input');
      this.events.replaceUserInputInTransaction(session, incoming.replaceTargetId, event, {
        assetCommits: incoming.assetCommitsByEventId.get(event.id),
      });
      return;
    }
    for (const event of incoming.events) {
      this.events.appendEventInTransaction(session, event, {
        assetCommits: incoming.assetCommitsByEventId.get(event.id),
      });
    }
  }
}
