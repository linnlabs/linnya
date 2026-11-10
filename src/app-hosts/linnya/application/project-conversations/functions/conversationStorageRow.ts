import type { ProjectConversationStorage } from '@app/schemas';

export interface ConversationStorageUsageRow {
  readonly record_bytes: number;
  readonly attachment_bytes: number;
  readonly has_shared_attachments: number;
  readonly work_file_bytes: number | null;
  readonly work_files_state: string;
  readonly measured_at: number;
}

const WORK_FILE_STATES = ['not_created', 'previous_files_unavailable', 'available', 'unavailable'] as const;

/** 缓存行转成对外合同；测量时间早于对话最近活动时视为过期，返回 null。 */
export function toConversationStorage(
  row: ConversationStorageUsageRow | undefined,
  lastEventAt: number,
): ProjectConversationStorage | null {
  if (!row || row.measured_at < lastEventAt) return null;
  const state = WORK_FILE_STATES.find(candidate => candidate === row.work_files_state);
  if (!state) return null;
  return {
    record_bytes: row.record_bytes,
    attachment_bytes: row.attachment_bytes,
    has_shared_attachments: row.has_shared_attachments === 1,
    work_file_bytes: row.work_file_bytes,
    work_files_state: state,
    measured_at: row.measured_at,
  };
}
