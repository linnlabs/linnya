import type Database from 'better-sqlite3';
import type { SubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import type { SubrunTraceHistoryProjectorPort } from './definitions/subrunTraceHistory';
import {
  encodeSubrunTraceHistoryPayload,
  isDurableSubrunTraceEvent,
} from './functions/subrunTraceHistoryPayload';
import { SqliteConversationCitationFactIndex } from '../event-store/ui-projection/sqliteCitationFactIndex';
import { SqliteUiProjectionApplier } from '../event-store/ui-projection/sqliteApplier';

interface SubrunTraceBindingRow {
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly parent_run_id: string | null;
  readonly parent_tool_call_id: string;
  readonly subrun_parent_id: string | null;
}

/**
 * 实时 trace 与历史 read model 在 Host 边界分流。这里只接收已经 admission 的 trace，
 * 因而 source_event_id、parent/subrun 绑定和时间顺序都来自正式 Runtime 事实。
 */
export class SqliteSubrunTraceHistoryProjector implements SubrunTraceHistoryProjectorPort {
  private readonly citationFactIndex: SqliteConversationCitationFactIndex;
  private readonly uiProjection: SqliteUiProjectionApplier;

  constructor(private readonly db: Database.Database) {
    this.citationFactIndex = new SqliteConversationCitationFactIndex(db);
    this.uiProjection = new SqliteUiProjectionApplier(db);
  }

  project(event: SubRunTraceEvent): void {
    const durable = isDurableSubrunTraceEvent(event);
    const binding = this.readBinding(event.subrun_id);
    if (binding) {
      this.requireMatchingBinding(binding, event);
      // chunk 不持久化；首帧只建立身份，此后逐帧不写表、不增加 UI revision。
      if (!durable) return;
    }

    const transaction = this.db.transaction(() => {
      if (!binding) {
        this.db
        .prepare(
          `
        INSERT INTO subrun_trace_runs (
          subrun_id,
          conversation_id,
          turn_id,
          parent_run_id,
          parent_tool_call_id,
          subrun_parent_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          event.subrun_id,
          event.conversation_id,
          event.turn_id,
          event.run_id ?? null,
          event.parent_tool_call_id,
          event.subrun_parent_id ?? null,
          event.timestamp
        );
      }

      if (isDurableSubrunTraceEvent(event)) {
        this.db.prepare(`
          INSERT INTO subrun_trace_items (subrun_id, source_event_id, kind, timestamp, payload_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(event.subrun_id, event.source_event_id, event.kind, event.timestamp,
          JSON.stringify(encodeSubrunTraceHistoryPayload(event)));
      }

      const parentChanged = event.run_id !== undefined && this.uiProjection.projectSubrunSummary(
        event.conversation_id, event.run_id, event.parent_tool_call_id,
      );
      const citationsChanged = durable && this.citationFactIndex.projectSubrunToolOutput(event);
      if (parentChanged || citationsChanged) {
        // 父索引与 citation sidecar 同属一次紧凑历史提交，只发布一个新 revision。
        this.uiProjection.bumpProjectionRevision(event.conversation_id);
      }
    });

    transaction();
  }

  private readBinding(subrunId: string): SubrunTraceBindingRow | undefined {
    return this.db.prepare<[string], SubrunTraceBindingRow>(`
      SELECT conversation_id, turn_id, parent_run_id, parent_tool_call_id, subrun_parent_id
      FROM subrun_trace_runs WHERE subrun_id = ?
    `).get(subrunId);
  }

  private requireMatchingBinding(binding: SubrunTraceBindingRow, event: SubRunTraceEvent): void {
    if (binding.conversation_id !== event.conversation_id
      || binding.turn_id !== event.turn_id
      || binding.parent_run_id !== (event.run_id ?? null)
      || binding.parent_tool_call_id !== event.parent_tool_call_id
      || binding.subrun_parent_id !== (event.subrun_parent_id ?? null)) {
      throw new Error(`[SubrunTraceHistory] subrun ${event.subrun_id} 与既有不可变归属绑定冲突`);
    }
  }
}
