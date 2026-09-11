/**
 * @file src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts
 * @description Linnya host adapter 的 EventStore SQLite 实现。
 */

import Database from 'better-sqlite3';
import { events as runtimeEvents } from '@linnlabs/linnkit/runtime-kernel';
import type {
  AppendEventToRunOptions,
  ConversationListItem,
  IEventStore,
  ReplaceUserInputEventOptions,
  ReplaceUserInputEventResult,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
  TruncateHistoryFromEventResult,
} from './event-store.interface';
import { getLogger } from 'src/shared/logger';
import {
  parseRuntimeEventRoutingIdentity,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { getRenderableRuntimeEventContent } from 'src/app-hosts/linnya/context/agent/userInputContext';
import {
  CONVERSATION_LIST_PINNED_SORT_OFFSET,
  decodeConversationListCursor,
  encodeConversationListCursor,
} from './conversation-list-cursor';
import {
  readConversationTotalEvents,
  SqliteUiProjectionApplier,
} from './ui-projection/sqliteApplier';
import { SqliteEventAssetLinks } from './event-asset-links/sqliteEventAssetLinks';
import {
  deleteHistoryFromRun,
  readStoredEventTarget,
} from './history-mutation/functions/sqliteHistoryMutation';
import {
  parseStoredRuntimeEvent,
  serializeStoredRuntimeEvent,
} from './functions/runtimeEventStorageCodec';
import { ConversationSelectedAgentIdSchema, type ConversationSelectedAgentId } from '@app/schemas';
import { SqliteSubrunTraceHistoryCleanup } from '../subrun-trace-history/sqliteSubrunTraceHistoryCleanup';

const logger = getLogger('SQLiteEventStore');

interface ConversationRow {
  conversation_id: string;
  title: string;
  created_at: number;
  last_event_at: number;
  preview_text: string | null;
  total_events: number;
  user_message_count: number | null;
  is_pinned: number | null;
  pinned_at: number | null;
  metadata: string | null;
  project_id: string | null;
  selected_agent_id: string | null;
  sort_cursor: number;
}

interface ConversationIdentityRow {
  conversation_id: string;
  created_at: number;
  metadata: string | null;
}

interface EventPayloadRow {
  id: string;
  type: string;
  payload: string;
  ts: number;
  run_id: string;
  parent_run_id: string | null;
}

interface RunOwnerRow {
  conversation_id: string;
  parent_run_id: string | null;
}

function readConversationMode(
  row: Pick<ConversationRow, 'conversation_id' | 'metadata'>
): string | undefined {
  try {
    if (!row.metadata) return undefined;
    const meta = JSON.parse(row.metadata) as { mode?: unknown };
    return typeof meta.mode === 'string' ? meta.mode : undefined;
  } catch (e) {
    logger.warn(`Failed to parse metadata for conversation ${row.conversation_id}`, e);
    return undefined;
  }
}

function toConversationListItem(row: ConversationRow): ConversationListItem {
  return {
    conversation_id: row.conversation_id,
    title: row.title,
    created_at: row.created_at,
    last_event_at: row.last_event_at,
    preview_text: row.preview_text ?? undefined,
    total_events: row.total_events,
    user_message_count: row.user_message_count || 0,
    project_id: row.project_id,
    is_pinned: row.is_pinned === 1,
    pinned_at: typeof row.pinned_at === 'number' ? row.pinned_at : undefined,
    mode: readConversationMode(row),
    selected_agent_id:
      row.selected_agent_id === null
        ? null
        : ConversationSelectedAgentIdSchema.parse(row.selected_agent_id),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConversationMetadata(
  conversationId: string,
  metadata: string | null
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const parsed: unknown = JSON.parse(metadata);
  if (!isRecord(parsed)) {
    throw new Error(
      `[SQLiteEventStore] conversation ${conversationId} metadata must be a JSON object`
    );
  }

  return { ...parsed };
}

function buildPreviewText(content: string): string {
  const trimmed = content.trim();
  const firstSentenceMatch = trimmed.match(/^[^。？！.?!\n]+[。？！.?!]?/);
  return firstSentenceMatch ? firstSentenceMatch[0].slice(0, 100) : trimmed.slice(0, 100);
}

/** AuditEnvelope 属于隐藏执行事实，不进入 conversation history 的统计口径。 */
function isConversationStatsEvent(event: RuntimeEvent): boolean {
  return event.ephemeral !== true && event.type !== 'audit_envelope';
}

export class SQLiteEventStore implements IEventStore {
  private db: Database.Database;
  private readonly uiProjection: SqliteUiProjectionApplier;
  private readonly eventAssetLinks: SqliteEventAssetLinks;

  /**
   * 构造函数（重构版）
   * @param db 由 DatabaseService 提供的统一数据库连接
   *
   * 注意：数据库连接和表创建已由 DatabaseService 统一管理，
   * 此服务只负责对话相关的业务逻辑。
   */
  constructor(db: Database.Database) {
    logger.info('[SQLiteEventStore] Initializing with provided database connection...');
    this.db = db;
    this.uiProjection = new SqliteUiProjectionApplier(db);
    this.eventAssetLinks = new SqliteEventAssetLinks(db);
    logger.info('[SQLiteEventStore] ✅ Initialized successfully');
  }

  // ⚠️ 废弃的数据库初始化逻辑已于 2025-11-10 移除
  // 新的统一初始化和迁移逻辑见 /electron-main/services/database.ts

  async beginRunSession(
    conversationId: string,
    runId: string,
    metadata: RunMetadata
  ): Promise<RunSession> {
    if (runId.trim().length === 0) {
      throw new Error('[SQLiteEventStore] beginRunSession requires an explicit runId');
    }
    const startedAt = Date.now();
    const transaction = this.db.transaction(() => {
      this.insertRunRecord(runId, conversationId, metadata, startedAt);
    });

    transaction();
    return { runId, conversationId, startedAt };
  }

  async openRunSession(conversationId: string, runId: string): Promise<RunSession> {
    const row = this.db
      .prepare(
        `
      SELECT id, conversation_id, start_ts
      FROM runs
      WHERE id = ?
      LIMIT 1
    `
      )
      .get(runId) as { id: string; conversation_id: string; start_ts: number } | undefined;

    if (!row) {
      throw new Error(`[SQLiteEventStore] run ${runId} does not exist`);
    }
    if (row.conversation_id !== conversationId) {
      throw new Error(
        `[SQLiteEventStore] run ${runId} belongs to conversation ${row.conversation_id}, cannot append events for ${conversationId}`
      );
    }

    return { runId: row.id, conversationId: row.conversation_id, startedAt: row.start_ts };
  }

  async appendEventToRun(
    session: RunSession,
    event: RoutedRuntimeEvent,
    opts: AppendEventToRunOptions = {}
  ): Promise<void> {
    this.appendEventInTransaction(session, event, opts);
  }

  /**
   * 同步事务边界供执行 checkpoint 提交复用；事件、资产引用与 UI 投影仍只有这一条写链。
   * 外层存在 SQLite 事务时，better-sqlite3 使用 savepoint，外层失败会回滚本次全部投影。
   */
  appendEventInTransaction(
    session: RunSession,
    event: RoutedRuntimeEvent,
    opts: AppendEventToRunOptions = {}
  ): void {
    this.assertEventScope(session, event);
    const transaction = this.db.transaction(() => {
      const totalEventsBeforeAppend = readConversationTotalEvents(this.db, session.conversationId);
      this.insertEventRecord(session.runId, session.conversationId, event, opts.eventStoreId);
      this.eventAssetLinks.persistForEvent({
        conversationId: session.conversationId,
        event,
        assetCommits: opts.assetCommits ?? [],
      });
      this.uiProjection.projectAppendedEvent(
        session.conversationId,
        session.runId,
        event,
        totalEventsBeforeAppend
      );
      this.updateConversationStats(session.conversationId, Date.now(), [event]);
    });

    transaction();
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    opts: ReplaceUserInputEventOptions = {}
  ): Promise<ReplaceUserInputEventResult> {
    return this.replaceUserInputInTransaction(session, targetEventId, replacement, opts);
  }

  replaceUserInputInTransaction(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    opts: ReplaceUserInputEventOptions = {}
  ): ReplaceUserInputEventResult {
    if (replacement.type !== 'user_input') {
      throw new Error('[SQLiteEventStore] replacement event must be user_input');
    }
    if (replacement.id !== targetEventId) {
      throw new Error('[SQLiteEventStore] replacement must preserve the target event ID');
    }
    this.assertEventScope(session, replacement);

    const transaction = this.db.transaction((): ReplaceUserInputEventResult => {
      const destinationRun = this.db
        .prepare(
          `
        SELECT id, conversation_id
        FROM runs
        WHERE id = ?
        LIMIT 1
      `
        )
        .get(session.runId) as { id: string; conversation_id: string } | undefined;
      if (!destinationRun || destinationRun.conversation_id !== session.conversationId) {
        throw new Error(
          `[SQLiteEventStore] destination run ${session.runId} is not open for conversation ${session.conversationId}`
        );
      }

      const target = readStoredEventTarget(this.db, session.conversationId, targetEventId);
      if (!target || target.event.type !== 'user_input') {
        throw new Error(
          `[SQLiteEventStore] replacement target ${targetEventId} is not a user_input fact in conversation ${session.conversationId}`
        );
      }
      if (target.runId === session.runId) {
        throw new Error(
          `[SQLiteEventStore] replacement target cannot belong to destination run ${session.runId}`
        );
      }

      const deleted = deleteHistoryFromRun({
        db: this.db,
        uiProjection: this.uiProjection,
        eventAssetLinks: this.eventAssetLinks,
        conversationId: session.conversationId,
        firstRunRowId: target.runRowId,
        excludedRunIds: [session.runId],
      });

      this.insertEventRecord(session.runId, session.conversationId, replacement);
      this.eventAssetLinks.persistForEvent({
        conversationId: session.conversationId,
        event: replacement,
        assetCommits: opts.assetCommits ?? [],
      });
      this.uiProjection.projectAppendedEvent(
        session.conversationId,
        session.runId,
        replacement,
        readConversationTotalEvents(this.db, session.conversationId)
      );
      this.recomputeConversationMetadataAfterTruncate(session.conversationId);

      return deleted;
    });

    return transaction();
  }

  async completeRun(session: RunSession): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.completeRunRecord(session.runId, Date.now());
    });

    transaction();
  }

  async failRun(session: RunSession, error: { code: string; message: string }): Promise<void> {
    logger.warn('[SQLiteEventStore] Marking run as failed', {
      runId: session.runId,
      conversationId: session.conversationId,
      error,
    });
    const transaction = this.db.transaction(() => {
      this.failRunRecord(session.runId, Date.now());
    });

    transaction();
  }

  private insertRunRecord(
    runId: string,
    conversationId: string,
    metadata: RunMetadata,
    startTs: number
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO runs (id, conversation_id, kind, status, model_key, toolset_version, start_ts, updated_ts)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
    `
      )
      .run(
        runId,
        conversationId,
        metadata.kind,
        metadata.model_key || null,
        metadata.toolset_version || null,
        startTs,
        startTs
      );
  }

  private insertEventRecord(
    runId: string,
    conversationId: string,
    event: RoutedRuntimeEvent,
    eventStoreId?: string
  ): void {
    try {
      this.db
        .prepare(
          `
        INSERT INTO events (id, run_id, type, payload, ts, event_store_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          event.id,
          runId,
          event.type,
          serializeStoredRuntimeEvent(event),
          event.timestamp,
          eventStoreId ?? null
        );
    } catch (e) {
      /**
       * 根因定位日志：events.id 主键冲突
       *
       * 中文备注：
       * - 这里不做“吞错/忽略插入”，而是把冲突的 event.id 明确打出来，便于定位是谁重复写入；
       * - UNIQUE constraint failed: events.id 的根因只能是：
       *   1) 本次 evts 内部存在重复 id；或
       *   2) 该 id 已经存在于 events 表（跨会话全局主键）。
       */
      const existing = this.db
        .prepare(
          `
          SELECT
            e.id as id,
            e.run_id as run_id,
            e.type as type,
            e.ts as ts,
            r.conversation_id as conversation_id
          FROM events e
          LEFT JOIN runs r ON r.id = e.run_id
          WHERE e.id = ?
          LIMIT 1
          `
        )
        .get(event.id) as
        | { id: string; run_id: string; type: string; ts: number; conversation_id: string | null }
        | undefined;
      const existingEventStoreId = eventStoreId
        ? (this.db
            .prepare(
              `
              SELECT
                e.id as id,
                e.run_id as run_id,
                e.type as type,
                e.ts as ts,
                e.event_store_id as event_store_id,
                r.conversation_id as conversation_id
              FROM events e
              LEFT JOIN runs r ON r.id = e.run_id
              WHERE e.event_store_id = ?
              LIMIT 1
              `
            )
            .get(eventStoreId) as
            | {
                id: string;
                run_id: string;
                type: string;
                ts: number;
                event_store_id: string;
                conversation_id: string | null;
              }
            | undefined)
        : undefined;
      const sqliteCode =
        e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
          ? e.code
          : undefined;
      logger.error('[SQLiteEventStore] events insert failed', {
        conversationId,
        runId,
        eventId: event.id,
        eventStoreId,
        eventType: event.type,
        sqliteCode,
        existsInEventsTable: !!existing,
        existsByEventStoreId: !!existingEventStoreId,
        existingEvent: existing
          ? {
              id: existing.id,
              runId: existing.run_id,
              type: existing.type,
              ts: existing.ts,
              conversationId: existing.conversation_id ?? undefined,
            }
          : undefined,
        existingEventStoreId: existingEventStoreId
          ? {
              id: existingEventStoreId.id,
              runId: existingEventStoreId.run_id,
              type: existingEventStoreId.type,
              ts: existingEventStoreId.ts,
              eventStoreId: existingEventStoreId.event_store_id,
              conversationId: existingEventStoreId.conversation_id ?? undefined,
            }
          : undefined,
      });
      throw e;
    }
  }

  private completeRunRecord(runId: string, endTs: number): void {
    this.db
      .prepare(
        `
      UPDATE runs SET status = 'completed', updated_ts = ?, end_ts = ? WHERE id = ?
    `
      )
      .run(endTs, endTs, runId);
  }

  private failRunRecord(runId: string, endTs: number): void {
    this.db
      .prepare(
        `
      UPDATE runs SET status = 'failed', updated_ts = ?, end_ts = ? WHERE id = ?
    `
      )
      .run(endTs, endTs, runId);
  }

  private updateConversationStats(
    conversationId: string,
    lastEventTs: number,
    events: RuntimeEvent[]
  ): void {
    const statsEvents = events.filter(isConversationStatsEvent);
    if (statsEvents.length === 0) return;
    const conversationEvents = statsEvents.filter(runtimeEvents.isConversationUiRuntimeEvent);
    const userMessageCount = conversationEvents.filter(e => e.type === 'user_input').length;

    // 按优先级查找预览内容：final_answer > user_input
    const previewEvent =
      conversationEvents.find(e => e.type === 'final_answer') ||
      conversationEvents.find(e => e.type === 'user_input');

    const previewContent = previewEvent
      ? getRenderableRuntimeEventContent(previewEvent)
      : undefined;
    if (previewContent) {
      const preview = buildPreviewText(previewContent);

      this.db
        .prepare(
          `
        UPDATE conversations
        SET preview_text = ?, last_event_at = ?, total_events = total_events + ?, user_message_count = user_message_count + ?
        WHERE conversation_id = ?
      `
        )
        .run(preview, lastEventTs, statsEvents.length, userMessageCount, conversationId);
    } else {
      // 只更新时间戳和事件计数
      this.db
        .prepare(
          `
        UPDATE conversations
        SET last_event_at = ?, total_events = total_events + ?, user_message_count = user_message_count + ?
        WHERE conversation_id = ?
      `
        )
        .run(lastEventTs, statsEvents.length, userMessageCount, conversationId);
    }
  }

  private recomputeConversationMetadataAfterTruncate(conversationId: string): void {
    const conversation = this.db
      .prepare<
        unknown[],
        ConversationIdentityRow
      >('SELECT conversation_id, created_at, metadata FROM conversations WHERE conversation_id = ? LIMIT 1')
      .get(conversationId);

    if (!conversation) {
      throw new Error(
        `[SQLiteEventStore] conversation ${conversationId} not found while recomputing metadata`
      );
    }

    const eventRows = this.db
      .prepare<unknown[], EventPayloadRow>(
        `
      SELECT
        e.id as id,
        e.type as type,
        e.payload as payload,
        e.ts as ts,
        e.run_id as run_id,
        r.parent_run_id as parent_run_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
        AND e.type <> 'audit_envelope'
      ORDER BY e.ts DESC, e.rowid DESC
    `
      )
      .all(conversationId);

    let totalEvents = 0;
    let userMessageCount = 0;
    let previewText: string | null = null;
    let latestStatsEventTs: number | undefined;

    for (const row of eventRows) {
      const event = parseStoredRuntimeEvent(row.payload, {
        eventId: row.id,
        eventType: row.type,
        conversationId,
        runId: row.run_id,
        parentRunId: row.parent_run_id,
        timestamp: row.ts,
      });
      if (!isConversationStatsEvent(event)) continue;
      totalEvents += 1;
      latestStatsEventTs ??= row.ts;
      const belongsToConversationUi = runtimeEvents.isConversationUiRuntimeEvent(event);
      if (belongsToConversationUi && event.type === 'user_input') {
        userMessageCount += 1;
      }

      if (
        belongsToConversationUi &&
        !previewText &&
        (event.type === 'final_answer' || event.type === 'user_input')
      ) {
        const previewContent = getRenderableRuntimeEventContent(event);
        if (previewContent?.trim()) {
          previewText = buildPreviewText(previewContent);
        }
      }
    }

    const lastEventAt = latestStatsEventTs ?? conversation.created_at;

    this.db
      .prepare(
        `
      UPDATE conversations
      SET total_events = ?, last_event_at = ?, user_message_count = ?, preview_text = ?
      WHERE conversation_id = ?
    `
      )
      .run(totalEvents, lastEventAt, userMessageCount, previewText ?? '', conversationId);
  }

  async readEvents(
    conversationId: string,
    options: ReadRuntimeEventsOptions = {}
  ): Promise<{ events: RoutedRuntimeEvent[]; nextCursor?: number; hasMore: boolean }> {
    const limit = options.limit || 200;
    const direction = options.direction || 'backward';
    const cursor = options.cursor;
    const excludeTypes = options.excludeTypes?.filter(type => type.length > 0) ?? [];

    /**
     * 关键：events 表没有 conversation_id / seq，只能通过 runs 关联，并使用 SQLite rowid 做稳定分页游标。
     * - rowid 单调递增，适合 forward/backward 分页
     * - 避免使用 ts 作为 cursor（同一毫秒多个事件会漏）
     */
    let sql = `
      SELECT
        e.rowid as seq,
        e.id as id,
        e.type as type,
        e.payload as payload,
        e.ts as ts,
        e.run_id as run_id,
        r.parent_run_id as parent_run_id
      FROM events e
      JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ?
    `;
    const params: Array<string | number> = [conversationId];

    if (excludeTypes.length > 0) {
      const placeholders = excludeTypes.map(() => '?').join(', ');
      sql += ` AND e.type NOT IN (${placeholders})`;
      params.push(...excludeTypes);
    }

    if (cursor !== undefined) {
      sql += direction === 'backward' ? ' AND e.rowid < ?' : ' AND e.rowid > ?';
      params.push(cursor);
    }

    sql += direction === 'backward' ? ' ORDER BY e.rowid DESC' : ' ORDER BY e.rowid ASC';
    sql += ' LIMIT ?';
    params.push(limit + 1); // 多取一条判断 hasMore

    const rows = this.db.prepare(sql).all(...params) as Array<{
      seq: number;
      id: string;
      type: string;
      payload: string;
      ts: number;
      run_id: string;
      parent_run_id: string | null;
    }>;
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    // 如果是 backward，需要反转顺序以保持时间正序（旧→新）
    if (direction === 'backward') {
      resultRows.reverse();
    }

    const events: RoutedRuntimeEvent[] = resultRows.flatMap((row, idx) => {
      try {
        const event = parseStoredRuntimeEvent(row.payload, {
          eventId: row.id,
          eventType: row.type,
          conversationId,
          runId: row.run_id,
          parentRunId: row.parent_run_id,
          timestamp: row.ts,
        });
        if (options.routingScope !== 'foreground-conversation') {
          return [event];
        }

        const identity = parseRuntimeEventRoutingIdentity(event);
        return identity.lane === 'foreground' && identity.visibility === 'conversation'
          ? [event]
          : [];
      } catch (err) {
        logger.error('[SQLiteEventStore] Failed to parse event payload', {
          conversationId,
          idx,
          seq: row.seq,
          error: err,
        });
        throw err;
      }
    });

    const nextCursor = hasMore
      ? direction === 'backward'
        ? resultRows[0].seq
        : resultRows[resultRows.length - 1].seq
      : undefined;
    return { events, nextCursor, hasMore };
  }

  async listConversations(
    options: { limit?: number; cursor?: string; search?: string; projectId?: string } = {}
  ): Promise<{ conversations: ConversationListItem[]; nextCursor?: string; hasMore: boolean }> {
    const limit = options.limit || 30;
    const cursor = decodeConversationListCursor(options.cursor);

    logger.info('Listing conversations', {
      limit,
      cursor,
      search: options.search,
      projectId: options.projectId,
    });

    const sortExpression = `
      CASE
        WHEN is_pinned = 1 THEN ${CONVERSATION_LIST_PINNED_SORT_OFFSET} + COALESCE(pinned_at, 0)
        ELSE last_event_at
      END
    `;
    let sql = `
      SELECT *, ${sortExpression} AS sort_cursor
      FROM conversations
      WHERE 1 = 1
    `;
    const params: Array<string | number> = [];

    if (cursor) {
      sql += ` AND (
        ${sortExpression} < ?
        OR (${sortExpression} = ? AND conversation_id < ?)
      )`;
      params.push(cursor.sortCursor, cursor.sortCursor, cursor.conversationId);
    }

    if (options.search) {
      sql += ' AND (title LIKE ? OR preview_text LIKE ?)';
      const searchPattern = `%${options.search}%`;
      params.push(searchPattern, searchPattern);
    }

    if (options.projectId) {
      sql += ' AND project_id = ?';
      params.push(options.projectId);
    } else {
      sql += ' AND project_id IS NULL';
    }

    // 中文备注：conversation_id 是 tie-breaker，避免多个会话同 sort_cursor 时跨页漏项。
    sql += ' ORDER BY sort_cursor DESC, conversation_id DESC LIMIT ?';
    params.push(limit + 1); // 多取一条判断 hasMore

    const rows = this.db.prepare<unknown[], ConversationRow>(sql).all(...params);
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const conversations = resultRows.map(toConversationListItem);

    const lastRow = resultRows[resultRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeConversationListCursor({
            sortCursor: lastRow.sort_cursor,
            conversationId: lastRow.conversation_id,
          })
        : undefined;

    logger.info(`Retrieved ${conversations.length} conversations, hasMore: ${hasMore}`);
    return { conversations, nextCursor, hasMore };
  }

  async deleteConversationsWithoutProject(): Promise<number> {
    /**
     * 兼容说明：
     * - project_id IS NULL 的会话现归属于 Linnya 助手；
     * - 该方法只保留给显式迁移/调试流程，启动维护不能调用。
     *
     * conversation event asset links 即使在 FK 关闭的维护连接中也必须显式删除。
     */
    const transaction = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT conversation_id FROM conversations WHERE project_id IS NULL')
        .all() as Array<{ conversation_id: string }>;
      for (const row of rows) {
        this.deleteConversationFacts(row.conversation_id);
      }
      return rows.length;
    });
    return transaction();
  }

  async getConversationMetadata(conversationId: string): Promise<ConversationListItem | null> {
    logger.info(`Getting metadata for conversation ${conversationId}`);

    const row = this.db
      .prepare('SELECT * FROM conversations WHERE conversation_id = ?')
      .get(conversationId) as ConversationRow | undefined;

    if (!row) {
      logger.info(`Conversation ${conversationId} not found`);
      return null;
    }

    return toConversationListItem(row);
  }

  async updateTitle(conversationId: string, title: string): Promise<boolean> {
    logger.info(`Updating title for conversation ${conversationId}`);

    try {
      const result = this.db
        .prepare(
          `
        UPDATE conversations
        SET title = ?
        WHERE conversation_id = ?
      `
        )
        .run(title, conversationId);

      if (result.changes > 0) {
        logger.info(`Successfully updated title for conversation ${conversationId}`);
        return true;
      } else {
        logger.warn(`Conversation ${conversationId} not found for title update`);
        return false;
      }
    } catch (error) {
      logger.error(`Failed to update title:`, error);
      throw error;
    }
  }

  async updatePinned(
    conversationId: string,
    pinned: boolean,
    pinnedAt: number | null
  ): Promise<boolean> {
    logger.info(`Updating pinned state for conversation ${conversationId}`, { pinned, pinnedAt });

    try {
      const result = this.db
        .prepare(
          `
        UPDATE conversations
        SET is_pinned = ?, pinned_at = ?
        WHERE conversation_id = ?
      `
        )
        .run(pinned ? 1 : 0, pinned ? pinnedAt : null, conversationId);

      if (result.changes > 0) {
        logger.info(`Successfully updated pinned state for conversation ${conversationId}`);
        return true;
      }

      logger.warn(`Conversation ${conversationId} not found for pinned update`);
      return false;
    } catch (error) {
      logger.error('Failed to update pinned state:', error);
      throw error;
    }
  }

  async updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null
  ): Promise<boolean> {
    logger.info('Materializing conversation selected agent', {
      conversationId,
      selectedAgentId,
      projectId,
    });

    const result = this.db
      .prepare(
        `
      INSERT INTO conversations (
        conversation_id,
        created_at,
        last_event_at,
        project_id,
        selected_agent_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        selected_agent_id = excluded.selected_agent_id
    `
      )
      .run(conversationId, Date.now(), Date.now(), projectId, selectedAgentId);

    return result.changes > 0;
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    logger.info(`Deleting conversation ${conversationId}`);

    try {
      const transaction = this.db.transaction((convId: string) => {
        return this.deleteConversationFacts(convId);
      });

      const deletedCount = transaction(conversationId);

      if (deletedCount > 0) {
        logger.info(`Successfully deleted conversation ${conversationId}`);
        return true;
      } else {
        logger.warn(`Conversation ${conversationId} not found for deletion`);
        return false;
      }
    } catch (error) {
      logger.error(`Failed to delete conversation:`, error);
      throw error;
    }
  }

  async truncateFromEvent(
    conversationId: string,
    eventId: string
  ): Promise<TruncateHistoryFromEventResult> {
    logger.info(`Truncating conversation ${conversationId} from event ${eventId}`);

    const transaction = this.db.transaction(
      (convId: string, targetEventId: string): TruncateHistoryFromEventResult => {
        const target = readStoredEventTarget(this.db, convId, targetEventId);
        if (!target) {
          return { found: false, deletedEventCount: 0, deletedRunCount: 0 };
        }

        const deleted = deleteHistoryFromRun({
          db: this.db,
          uiProjection: this.uiProjection,
          eventAssetLinks: this.eventAssetLinks,
          conversationId: convId,
          firstRunRowId: target.runRowId,
        });
        this.uiProjection.bumpProjectionRevision(convId);
        this.recomputeConversationMetadataAfterTruncate(convId);
        return { found: true, ...deleted };
      }
    );

    const result = transaction(conversationId, eventId);

    logger.info('Truncation completed', { conversationId, eventId, ...result });
    return result;
  }

  /**
   * 🔥 新实现：确保会话存在
   */
  async ensureConversation(
    conversationId: string,
    initialEvents: RuntimeEvent[],
    projectId?: string,
    mode?: string
  ): Promise<void> {
    logger.info(
      `[ensureConversation] Called with conversationId: ${conversationId}, projectId: ${projectId}, mode: ${mode}`
    );
    const conv = this.db
      .prepare<
        unknown[],
        ConversationIdentityRow
      >('SELECT conversation_id, created_at, metadata FROM conversations WHERE conversation_id = ? LIMIT 1')
      .get(conversationId);

    if (!conv) {
      const firstUserEvent = initialEvents.find(e => e.type === 'user_input');
      const firstUserContent = firstUserEvent
        ? getRenderableRuntimeEventContent(firstUserEvent)
        : undefined;
      const preview = firstUserContent ? firstUserContent.slice(0, 100) : '';
      const now = Date.now();

      const projectIdToInsert = projectId || null;
      const metadataJson = mode ? JSON.stringify({ mode }) : null;

      logger.info(
        `[ensureConversation] Creating NEW conversation. projectId to insert: ${projectIdToInsert}, mode: ${mode}`
      );

      this.db
        .prepare(
          `
        INSERT INTO conversations (conversation_id, created_at, last_event_at, preview_text, total_events, user_message_count, project_id, metadata)
        VALUES (?, ?, ?, ?, 0, 0, ?, ?)
      `
        )
        .run(conversationId, now, now, preview, projectIdToInsert, metadataJson);

      logger.info(
        `[ensureConversation] ✅ Created new conversation ${conversationId} for project ${projectIdToInsert} with mode: ${mode}`
      );
    } else {
      // 如果会话已存在，尝试更新 mode（如果提供了 mode 且与当前不同）
      if (mode) {
        const currentMeta = parseConversationMetadata(conversationId, conv.metadata);

        // 只有当 mode 确实改变时才更新，其他 metadata 字段必须原样保留。
        if (currentMeta.mode !== mode) {
          currentMeta.mode = mode;
          this.db
            .prepare('UPDATE conversations SET metadata = ? WHERE conversation_id = ?')
            .run(JSON.stringify(currentMeta), conversationId);
          logger.info(
            `[ensureConversation] Updated existing conversation ${conversationId} mode to ${mode}`
          );
        }
      }
      logger.info(`[ensureConversation] Conversation ${conversationId} already exists.`);
    }
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }

  // ===========================================
  // 🔧 私有辅助方法
  // ===========================================

  /**
   * 会话删除必须显式覆盖全部本地事实，不能让连接级 FK pragma 改变业务语义。
   */
  private deleteConversationFacts(conversationId: string): number {
    this.eventAssetLinks.deleteForConversation(conversationId);
    this.uiProjection.deleteProjectionRowsForConversation(conversationId);
    new SqliteSubrunTraceHistoryCleanup(this.db).deleteForConversation(conversationId);
    this.db
      .prepare(
        `
      DELETE FROM events
      WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)
    `
      )
      .run(conversationId);
    this.db.prepare('DELETE FROM runs WHERE conversation_id = ?').run(conversationId);
    return this.db
      .prepare('DELETE FROM conversations WHERE conversation_id = ?')
      .run(conversationId).changes;
  }

  private assertEventScope(session: RunSession, event: RuntimeEvent): void {
    runtimeEvents.requirePersistableRoutedRuntimeEvent(event);
    if (event.conversation_id !== session.conversationId) {
      throw new Error(
        `[SQLiteEventStore] event ${event.id} belongs to conversation ${event.conversation_id}, ` +
          `cannot append it to ${session.conversationId}`
      );
    }
    const identity = parseRuntimeEventRoutingIdentity(event);
    if (identity.run_id !== session.runId) {
      throw new Error(
        `[SQLiteEventStore] event ${event.id} belongs to run ${identity.run_id}, ` +
          `cannot append it to ${session.runId}`
      );
    }

    const owner = this.db
      .prepare<unknown[], RunOwnerRow>(
        `
      SELECT conversation_id, parent_run_id
      FROM runs
      WHERE id = ?
      LIMIT 1
    `
      )
      .get(session.runId);
    if (!owner) {
      throw new Error(`[SQLiteEventStore] run ${session.runId} does not exist`);
    }
    if (owner.conversation_id !== session.conversationId) {
      throw new Error(
        `[SQLiteEventStore] run ${session.runId} belongs to conversation ${owner.conversation_id}, ` +
          `but the session belongs to ${session.conversationId}`
      );
    }
    if ((identity.parent_run_id ?? null) !== owner.parent_run_id) {
      throw new Error(
        `[SQLiteEventStore] event ${event.id} has parent run ${identity.parent_run_id ?? 'none'}, ` +
          `but run ${session.runId} declares ${owner.parent_run_id ?? 'none'}`
      );
    }
  }
}
