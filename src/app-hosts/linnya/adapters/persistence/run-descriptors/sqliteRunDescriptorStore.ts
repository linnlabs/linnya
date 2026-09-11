import type Database from 'better-sqlite3';
import {
  RunDescriptorSchema,
  serializeRunDescriptor,
  type RunDescriptor,
  type RunDescriptorStore,
} from '../../../application/run-resumption';
import { readRuntimeEventsByIds } from '../event-store';

export class SqliteRunDescriptorStore implements RunDescriptorStore {
  constructor(private readonly db: Database.Database) {}

  async insert(descriptor: RunDescriptor): Promise<void> {
    this.insertInTransaction(descriptor);
  }

  insertInTransaction(descriptor: RunDescriptor): void {
    const serialized = serializeRunDescriptor(descriptor);
    this.db
      .prepare('INSERT INTO agent_run_descriptors (run_id, descriptor_json) VALUES (?, ?)')
      .run(descriptor.runId, serialized);
  }

  markCheckpointCommittedInTransaction(runId: string): void {
    this.db
      .prepare('UPDATE agent_run_descriptors SET checkpoint_committed = 1 WHERE run_id = ?')
      .run(runId);
  }

  async hasCommittedCheckpoint(runId: string): Promise<boolean> {
    const row = this.db
      .prepare<
        [string],
        { checkpoint_committed: number }
      >('SELECT checkpoint_committed FROM agent_run_descriptors WHERE run_id = ?')
      .get(runId);
    if (!row) throw new Error('Run descriptor is unavailable');
    return row.checkpoint_committed === 1;
  }

  async loadEvents(conversationId: string, eventIds: readonly string[]) {
    return readRuntimeEventsByIds(this.db, conversationId, eventIds);
  }

  async load(runId: string): Promise<RunDescriptor | null> {
    const row = this.db
      .prepare<
        [string],
        { descriptor_json: string }
      >('SELECT descriptor_json FROM agent_run_descriptors WHERE run_id = ?')
      .get(runId);
    if (!row) return null;
    const descriptor = RunDescriptorSchema.parse(JSON.parse(row.descriptor_json));
    if (descriptor.runId !== runId) throw new Error('Run descriptor row identity mismatch');
    return descriptor;
  }

  async remove(runId: string): Promise<void> {
    this.db.prepare('DELETE FROM agent_run_descriptors WHERE run_id = ?').run(runId);
  }

  async exists(runId: string): Promise<boolean> {
    return (
      this.db.prepare('SELECT 1 FROM agent_run_descriptors WHERE run_id = ?').get(runId) !==
      undefined
    );
  }

  async loadInputs(descriptor: RunDescriptor) {
    return this.db.transaction(() => ({
      history: readRuntimeEventsByIds(
        this.db,
        descriptor.conversationId,
        descriptor.historyEventIds
      ),
      newEvents: readRuntimeEventsByIds(
        this.db,
        descriptor.conversationId,
        descriptor.incomingEventIds
      ),
    }))();
  }
}
