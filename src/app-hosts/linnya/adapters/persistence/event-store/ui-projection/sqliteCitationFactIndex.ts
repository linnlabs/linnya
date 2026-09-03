import type Database from 'better-sqlite3';
import type { SubRunTraceEvent, ToolOutputEvent } from 'linnkit/contracts';
import { shouldReplayRuntimeEventToUi } from 'linnkit/runtime-kernel/events';
import {
  SearchResultCitationSchema,
  conversationMessageIdFromToolIdentity,
  type SearchResultCitation,
} from '@app/schemas';
import {
  admitCitationsFromConversationSubrunOutput,
  admitCitationsFromConversationToolOutput,
  createConversationCitationWorkspace,
  projectConversationCitationRegistration,
} from '../../../../../../domains/citation/conversation-presentation';

import type { DurableSubrunTraceKind } from '../../subrun-trace-history/definitions/subrunTraceHistory';
import { decodeSubrunTraceHistoryEvent } from '../../subrun-trace-history/functions/subrunTraceHistoryPayload';
import { isRecord } from './json';

type CitationFactProducerKind = 'main_tool' | 'subrun_tool';

interface CitationFactSqlRow {
  readonly id: number;
  readonly scope_id: string;
  readonly ref: string;
  readonly available_sort_seq: number;
  readonly timestamp: number;
  readonly producer_kind: CitationFactProducerKind;
  readonly citation_json: string;
}

interface MainToolSortSeqSqlRow {
  readonly sort_seq: number;
}

interface SubrunBindingSqlRow {
  readonly conversation_id: string;
  readonly subrun_id: string;
  readonly parent_run_id: string | null;
  readonly parent_tool_call_id: string;
  readonly subrun_parent_id: string | null;
}

interface SubrunTraceSqlRow {
  readonly id: number;
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly parent_run_id: string | null;
  readonly parent_tool_call_id: string;
  readonly subrun_id: string;
  readonly subrun_parent_id: string | null;
  readonly source_event_id: string;
  readonly kind: DurableSubrunTraceKind;
  readonly timestamp: number;
  readonly payload_json: string;
}

interface CitationFactRegistration {
  readonly conversationId: string;
  readonly scopeId: string;
  readonly availableSortSeq: number;
  readonly timestamp: number;
  readonly producerKind: CitationFactProducerKind;
  readonly producerId: string;
  readonly ownerRunId: string;
  readonly citations: readonly SearchResultCitation[];
}

interface IndexedConversationCitationFact {
  readonly factOrder: number;
  readonly scopeId: string;
  readonly availableSortSeq: number;
  readonly timestamp: number;
  readonly producerKind: CitationFactProducerKind;
  readonly citation: SearchResultCitation;
}

interface CitationAvailability {
  readonly sortSeq: number;
  readonly ownerRunId: string;
}

// Window 上限可能带来数千个 ref；分批只为遵守 SQLite bind parameter 上限，不改变业务结果。
const MAX_REFS_PER_QUERY = 400;

/**
 * Conversation UI citation fact 的 SQLite 派生索引。
 *
 * 这里保存的是可从 durable tool/subrun facts 重建的规范化索引，不是新的 Citation SoT。
 * Citation 的作用域、冲突和来源身份规则仍由 Citation domain 决定。
 */
export class SqliteConversationCitationFactIndex {
  constructor(private readonly db: Database.Database) {}

  projectMainToolOutput(event: ToolOutputEvent, ownerRunId: string): void {
    if (!shouldReplayRuntimeEventToUi(event)) return;

    const presentation = isRecord(event.metadata?.presentation)
      ? event.metadata.presentation
      : undefined;
    const admission = admitCitationsFromConversationToolOutput({
      toolName: event.tool_name,
      status: event.status,
      result:
        event.status === 'success'
          ? {
              data: event.data,
              observation: event.observation,
              ...(presentation ?? {}),
            }
          : {
              error: event.error,
              observation: event.observation,
            },
    });
    if (!admission) return;

    const messageId = conversationMessageIdFromToolIdentity(ownerRunId, event.tool_call_id);
    const toolRow = this.db
      .prepare<unknown[], MainToolSortSeqSqlRow>(
        `
        SELECT sort_seq
        FROM conversation_ui_messages
        WHERE conversation_id = ? AND message_id = ?
        LIMIT 1
      `
      )
      .get(event.conversation_id, messageId);
    if (!toolRow) {
      throw new Error(
        `[ConversationCitationFactIndex] main tool message=${messageId} 缺少 UI projection row`
      );
    }

    this.projectRegistration({
      conversationId: event.conversation_id,
      scopeId: event.turn_id,
      availableSortSeq: toolRow.sort_seq,
      timestamp: event.timestamp,
      producerKind: 'main_tool',
      producerId: event.id,
      ownerRunId,
      citations: admission.citations,
    });
  }

  projectSubrunToolOutput(event: SubRunTraceEvent): boolean {
    if (event.kind !== 'tool_output' || typeof event.tool_name !== 'string') return false;
    const admission = admitCitationsFromConversationSubrunOutput({
      toolName: event.tool_name,
      status:
        event.status === 'success' ? 'success' : event.status === 'error' ? 'error' : 'loading',
      output: event.output,
    });
    if (!admission) return false;

    const availability = this.readSubrunCitationAvailability(
      event.conversation_id,
      event.subrun_id
    );
    // 没有正式 main parent tool 的 child fact 不属于 Conversation 引用作用域。
    if (!availability) return false;

    return this.projectRegistration({
      conversationId: event.conversation_id,
      scopeId: event.turn_id,
      availableSortSeq: availability.sortSeq,
      timestamp: event.timestamp,
      producerKind: 'subrun_tool',
      producerId: event.source_event_id,
      ownerRunId: availability.ownerRunId,
      citations: admission.citations,
    });
  }

  readFactsForRefs(
    conversationId: string,
    refs: readonly string[],
    beforeSortSeq: number
  ): IndexedConversationCitationFact[] {
    const uniqueRefs = [...new Set(refs)];
    if (uniqueRefs.length === 0) return [];

    const rows: CitationFactSqlRow[] = [];
    for (let offset = 0; offset < uniqueRefs.length; offset += MAX_REFS_PER_QUERY) {
      const refChunk = uniqueRefs.slice(offset, offset + MAX_REFS_PER_QUERY);
      const placeholders = refChunk.map(() => '?').join(',');
      rows.push(
        ...this.db
          .prepare<unknown[], CitationFactSqlRow>(
            `
          SELECT
            id,
            scope_id,
            ref,
            available_sort_seq,
            timestamp,
            producer_kind,
            citation_json
          FROM conversation_ui_citation_facts
          WHERE conversation_id = ?
            AND available_sort_seq < ?
            AND ref IN (${placeholders})
        `
          )
          .all(conversationId, beforeSortSeq, ...refChunk)
      );
    }

    return rows.map(parseCitationFactRow).sort(compareCitationFacts);
  }

  rebuildSubrunFacts(conversationId: string): void {
    const rows = this.db
      .prepare<unknown[], SubrunTraceSqlRow>(
        `
        SELECT
          i.id,
          r.conversation_id,
          r.turn_id,
          r.parent_run_id,
          r.parent_tool_call_id,
          r.subrun_id,
          r.subrun_parent_id,
          i.source_event_id,
          i.kind,
          i.timestamp,
          i.payload_json
        FROM subrun_trace_items i
        JOIN subrun_trace_runs r ON r.subrun_id = i.subrun_id
        WHERE r.conversation_id = ? AND i.kind = 'tool_output'
        ORDER BY i.id ASC
      `
      )
      .all(conversationId);

    for (const row of rows) {
      const event = decodeSubrunTraceHistoryEvent({
        itemId: row.id,
        conversationId: row.conversation_id,
        turnId: row.turn_id,
        parentRunId: row.parent_run_id,
        parentToolCallId: row.parent_tool_call_id,
        subrunId: row.subrun_id,
        subrunParentId: row.subrun_parent_id,
        sourceEventId: row.source_event_id,
        kind: row.kind,
        timestamp: row.timestamp,
        payloadJson: row.payload_json,
      });
      this.projectSubrunToolOutput(event);
    }
  }

  deleteForRuns(conversationId: string, ownerRunIds: readonly string[]): void {
    if (ownerRunIds.length === 0) return;
    const placeholders = ownerRunIds.map(() => '?').join(',');
    this.db
      .prepare(
        `
        DELETE FROM conversation_ui_citation_facts
        WHERE conversation_id = ? AND owner_run_id IN (${placeholders})
      `
      )
      .run(conversationId, ...ownerRunIds);
  }

  deleteForConversation(conversationId: string): void {
    this.db
      .prepare('DELETE FROM conversation_ui_citation_facts WHERE conversation_id = ?')
      .run(conversationId);
  }

  private projectRegistration(registration: CitationFactRegistration): boolean {
    if (registration.citations.length === 0) return false;
    this.assertScopedRegistrationCompatible(registration);

    const insert = this.db.prepare(`
      INSERT INTO conversation_ui_citation_facts (
        conversation_id,
        scope_id,
        ref,
        available_sort_seq,
        timestamp,
        producer_kind,
        producer_id,
        owner_run_id,
        citation_ordinal,
        citation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    registration.citations.forEach((citation, ordinal) => {
      insert.run(
        registration.conversationId,
        registration.scopeId,
        citation.ref,
        registration.availableSortSeq,
        registration.timestamp,
        registration.producerKind,
        registration.producerId,
        registration.ownerRunId,
        ordinal,
        JSON.stringify(citation)
      );
    });
    return true;
  }

  /** 写入前复用 domain 规则验证同 scope/ref，避免把冲突拖到窗口读取阶段。 */
  private assertScopedRegistrationCompatible(registration: CitationFactRegistration): void {
    const refs = [...new Set(registration.citations.map(citation => citation.ref))];
    const placeholders = refs.map(() => '?').join(',');
    const existingRows = this.db
      .prepare<unknown[], CitationFactSqlRow>(
        `
        SELECT
          id,
          scope_id,
          ref,
          available_sort_seq,
          timestamp,
          producer_kind,
          citation_json
        FROM conversation_ui_citation_facts
        WHERE conversation_id = ?
          AND scope_id = ?
          AND ref IN (${placeholders})
      `
      )
      .all(registration.conversationId, registration.scopeId, ...refs)
      .map(parseCitationFactRow)
      .sort(compareCitationFacts);

    let workspace = createConversationCitationWorkspace();
    for (const fact of existingRows) {
      workspace = projectConversationCitationRegistration(workspace, fact.scopeId, [fact.citation]);
    }
    projectConversationCitationRegistration(
      workspace,
      registration.scopeId,
      registration.citations
    );
  }

  private readSubrunCitationAvailability(
    conversationId: string,
    subrunId: string
  ): CitationAvailability | null {
    let currentSubrunId: string | null = subrunId;
    const visited = new Set<string>();
    while (currentSubrunId !== null) {
      if (visited.has(currentSubrunId)) {
        throw new Error(
          `[ConversationCitationFactIndex] subrun parent chain 存在环: ${currentSubrunId}`
        );
      }
      visited.add(currentSubrunId);

      const binding = this.db
        .prepare<unknown[], SubrunBindingSqlRow>(
          `
          SELECT
            conversation_id,
            subrun_id,
            parent_run_id,
            parent_tool_call_id,
            subrun_parent_id
          FROM subrun_trace_runs
          WHERE subrun_id = ?
          LIMIT 1
        `
        )
        .get(currentSubrunId);
      if (!binding) {
        throw new Error(
          `[ConversationCitationFactIndex] subrun=${currentSubrunId} 缺少 run binding`
        );
      }
      if (binding.conversation_id !== conversationId) {
        throw new Error(
          `[ConversationCitationFactIndex] subrun=${currentSubrunId} 跨 Conversation 绑定`
        );
      }

      if (binding.parent_run_id !== null) {
        const parentMessageId = conversationMessageIdFromToolIdentity(
          binding.parent_run_id,
          binding.parent_tool_call_id
        );
        const parentTool = this.db
          .prepare<unknown[], MainToolSortSeqSqlRow>(
            `
            SELECT sort_seq
            FROM conversation_ui_messages
            WHERE conversation_id = ? AND message_id = ?
            LIMIT 1
          `
          )
          .get(conversationId, parentMessageId);
        if (parentTool) {
          return { sortSeq: parentTool.sort_seq, ownerRunId: binding.parent_run_id };
        }
      }
      currentSubrunId = binding.subrun_parent_id;
    }
    return null;
  }
}

function parseCitationFactRow(row: CitationFactSqlRow): IndexedConversationCitationFact {
  const citation = SearchResultCitationSchema.parse(JSON.parse(row.citation_json));
  if (citation.ref !== row.ref) {
    throw new Error(
      `[ConversationCitationFactIndex] indexed ref=${row.ref} 与 citation.ref=${citation.ref} 不一致`
    );
  }
  return {
    factOrder: row.id,
    scopeId: row.scope_id,
    availableSortSeq: row.available_sort_seq,
    timestamp: row.timestamp,
    producerKind: row.producer_kind,
    citation,
  };
}

function compareCitationFacts(
  left: IndexedConversationCitationFact,
  right: IndexedConversationCitationFact
): number {
  return (
    left.availableSortSeq - right.availableSortSeq ||
    left.timestamp - right.timestamp ||
    left.producerKind.localeCompare(right.producerKind) ||
    left.factOrder - right.factOrder
  );
}
