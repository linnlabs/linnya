import type Database from 'better-sqlite3';
import type {
  ProjectConversationsMeasure,
  ProjectConversationsMeasureRequest,
  ProjectConversationStorage,
} from '@app/schemas';
import {
  deriveConversationWorkDirectoryIdentity,
  type ConversationWorkDirectoryUsagePort,
} from 'src/domains/conversation-files';

interface StorageTargetRow {
  readonly conversation_id: string;
  readonly last_event_at: number;
}

/**
 * 测量对话占用并写入缓存。对话记录按对话汇总数据库字节数（事件、UI 消息、子运行轨迹、引用事实），
 * 附件按引用的资产大小计（同一资产被多个对话引用时每个都计入并注明），过程文件读对话工作目录。
 *
 * 不在写事件的路径上计数：这里只在用户打开对话页时测“没测过或测后又有新活动”的对话，
 * 单个对话按运行索引汇总是毫秒级；第一次打开时整项目测一遍。
 */
export function createProjectConversationStorageMeasurer(input: {
  readonly db: Database.Database;
  readonly workDirectoryUsage: ConversationWorkDirectoryUsagePort;
  readonly now?: () => number;
}) {
  const { db } = input;
  const now = input.now ?? Date.now;
  const recordBytes = db.prepare<[string, string, string, string], { bytes: number }>(`
    SELECT
      (SELECT COALESCE(SUM(length(CAST(e.payload AS BLOB))), 0)
        FROM runs r JOIN events e ON e.run_id = r.id WHERE r.conversation_id = ?)
      + (SELECT COALESCE(SUM(length(CAST(COALESCE(content, '') AS BLOB)) + length(CAST(COALESCE(payload_json, '') AS BLOB))
          + length(CAST(COALESCE(attachments_json, '') AS BLOB))), 0)
        FROM conversation_ui_messages WHERE conversation_id = ?)
      + (SELECT COALESCE(SUM(length(CAST(i.payload_json AS BLOB))), 0)
        FROM subrun_trace_runs t JOIN subrun_trace_items i ON i.subrun_id = t.subrun_id WHERE t.conversation_id = ?)
      + (SELECT COALESCE(SUM(length(CAST(citation_json AS BLOB))), 0)
        FROM conversation_ui_citation_facts WHERE conversation_id = ?) AS bytes
  `);
  const attachments = db.prepare<[{ id: string }], { bytes: number; shared: number }>(`
    WITH mine AS (SELECT DISTINCT asset_id FROM conversation_event_asset_links WHERE conversation_id = @id)
    SELECT COALESCE(SUM(a.size_bytes), 0) AS bytes,
      COALESCE(MAX(EXISTS (
        SELECT 1 FROM conversation_event_asset_links other
        WHERE other.asset_id = mine.asset_id AND other.conversation_id <> @id
      )), 0) AS shared
    FROM mine JOIN assets a ON a.id = mine.asset_id
  `);
  const save = db.prepare(`
    INSERT INTO conversation_storage_usage (
      conversation_id, record_bytes, attachment_bytes, has_shared_attachments, work_file_bytes, work_files_state, measured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      record_bytes = excluded.record_bytes, attachment_bytes = excluded.attachment_bytes,
      has_shared_attachments = excluded.has_shared_attachments, work_file_bytes = excluded.work_file_bytes,
      work_files_state = excluded.work_files_state, measured_at = excluded.measured_at
  `);

  async function measureOne(conversationId: string): Promise<ProjectConversationStorage> {
    const measuredAt = now();
    const record = recordBytes.get(conversationId, conversationId, conversationId, conversationId)?.bytes ?? 0;
    const attachment = attachments.get({ id: conversationId }) ?? { bytes: 0, shared: 0 };
    let workFileBytes: number | null = null;
    let workFilesState: ProjectConversationStorage['work_files_state'] = 'unavailable';
    try {
      const usage = await input.workDirectoryUsage.measureWorkDirectory(deriveConversationWorkDirectoryIdentity(conversationId));
      workFileBytes = usage.byteSize;
      workFilesState = usage.state;
    } catch {
      // 目录被外部替换、锁定或拒绝访问时不伪装成 0，也不拖垮其他对话。
    }
    const storage: ProjectConversationStorage = {
      record_bytes: record,
      attachment_bytes: attachment.bytes,
      has_shared_attachments: attachment.shared === 1,
      work_file_bytes: workFileBytes,
      work_files_state: workFilesState,
      measured_at: measuredAt,
    };
    // 对话可能在测量途中被删除；外键会拒绝写入，此时只返回结果、不缓存。
    const stillExists = db.prepare('SELECT 1 FROM conversations WHERE conversation_id = ?').get(conversationId);
    if (stillExists) {
      save.run(conversationId, storage.record_bytes, storage.attachment_bytes, storage.has_shared_attachments ? 1 : 0,
        storage.work_file_bytes, storage.work_files_state, storage.measured_at);
    }
    return storage;
  }

  return {
    async measure(request: ProjectConversationsMeasureRequest): Promise<ProjectConversationsMeasure> {
      const targets = request.conversation_ids === undefined
        ? db.prepare<[string], StorageTargetRow>(`
            SELECT c.conversation_id, c.last_event_at FROM conversations c
            LEFT JOIN conversation_storage_usage s ON s.conversation_id = c.conversation_id
            WHERE c.project_id = ? AND (s.measured_at IS NULL OR s.measured_at < c.last_event_at)
            ORDER BY c.last_event_at DESC
          `).all(request.project_id)
        : db.prepare<[string, string], StorageTargetRow>(`
            SELECT conversation_id, last_event_at FROM conversations
            WHERE project_id = ? AND conversation_id IN (SELECT value FROM json_each(?))
          `).all(request.project_id, JSON.stringify(request.conversation_ids));
      const measurements: ProjectConversationsMeasure['measurements'] = [];
      // 顺序测量，避免一次打开成百上千个目录句柄。
      for (const target of targets) {
        measurements.push({ conversation_id: target.conversation_id, storage: await measureOne(target.conversation_id) });
      }
      return { measurements };
    },
  };
}

export type ProjectConversationStorageMeasurer = ReturnType<typeof createProjectConversationStorageMeasurer>;
