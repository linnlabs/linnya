import type Database from 'better-sqlite3';

import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { getLogger } from 'src/shared/logger';
import type { IEventStore, RunSession } from './event-store.interface';
import { parseStoredRuntimeEvent } from './functions/runtimeEventStorageCodec';

const logger = getLogger('LinnyaEventStoreAdapter');

type EventRangeOptions = graph.EventRangeOptions;
type PersistedEvent = graph.PersistedEvent;

interface PersistedEventRow {
  id: string;
  type: string;
  payload: string;
  ts: number;
  run_id: string;
  conversation_id: string;
  parent_run_id: string | null;
  event_store_id: string;
}

export class LinnyaEventStoreAdapter implements graph.EventStore {
  constructor(
    private readonly db: Database.Database,
    private readonly host: IEventStore,
  ) {}

  async append(persistedEvent: PersistedEvent): Promise<void> {
    const eventStoreId = graph.requireEventStoreId(persistedEvent.eventStoreId);
    const event = persistedEvent.event;
    const session: RunSession = await this.host.openRunSession(event.conversation_id, event.run_id);

    await this.host.appendEventToRun(session, event, { eventStoreId });
  }

  async range(conversationId: string, opts: EventRangeOptions = {}): Promise<PersistedEvent[]> {
    const fromEventStoreId = opts.fromEventStoreId ?? null;
    const toEventStoreId = opts.toEventStoreId ?? null;
    const limit = opts.limit ?? 1000;
    const rows = this.db.prepare(`
      SELECT
        e.id as id,
        e.type as type,
        e.payload as payload,
        e.ts as ts,
        e.run_id as run_id,
        r.conversation_id as conversation_id,
        r.parent_run_id as parent_run_id,
        e.event_store_id as event_store_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
        AND e.event_store_id IS NOT NULL
        AND (? IS NULL OR e.event_store_id > ?)
        AND (? IS NULL OR e.event_store_id <= ?)
      ORDER BY e.event_store_id ASC
      LIMIT ?
    `).all(
      conversationId,
      fromEventStoreId,
      fromEventStoreId,
      toEventStoreId,
      toEventStoreId,
      limit,
    ) as PersistedEventRow[];

    return rows.map((row) => ({
      eventStoreId: row.event_store_id,
      event: parseStoredRuntimeEvent(row.payload, {
        eventId: row.id,
        eventType: row.type,
        conversationId: row.conversation_id,
        runId: row.run_id,
        parentRunId: row.parent_run_id,
        timestamp: row.ts,
      }),
    }));
  }

  async latestEventStoreId(conversationId: string): Promise<string | null> {
    const row = this.db.prepare(`
      SELECT e.event_store_id as event_store_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ? AND e.event_store_id IS NOT NULL
      ORDER BY e.event_store_id DESC
      LIMIT 1
    `).get(conversationId) as { event_store_id: string } | undefined;

    return row?.event_store_id ?? null;
  }

  async truncate(
    _conversationId: string,
    _opts: { beforeEventStoreId?: string; beforeMs?: number },
  ): Promise<void> {
    logger.warn(
      '[LinnyaEventStoreAdapter] truncate() called but event-grained truncate is not implemented in B3b',
    );
    throw new Error('LinnyaEventStoreAdapter.truncate() not implemented; see engine/22 §11.4');
  }
}
