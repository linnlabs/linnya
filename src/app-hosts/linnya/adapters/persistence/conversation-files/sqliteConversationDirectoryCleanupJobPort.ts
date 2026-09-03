import type Database from 'better-sqlite3';

import {
  ConversationDirectoryCleanupJobError,
  advanceConversationDirectoryCleanupFailure,
  parseStoredConversationDirectoryCleanupJob,
  resolveConversationDirectoryCleanupJobBegin,
  type ConversationDirectoryCleanupFailure,
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobBeginResult,
  type ConversationDirectoryCleanupJobFailureStage,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryCleanupJobScope,
} from '../../../../../domains/conversation-files';

interface ConversationDirectoryCleanupJobRow {
  conversation_id: string;
  job_id: string;
  operation_kind: string;
  requested_at: number;
  retry_count: number;
  last_failure_json: string | null;
}

function readStorageCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function mapPersistenceFailure(
  error: unknown,
  stage: ConversationDirectoryCleanupJobFailureStage,
): ConversationDirectoryCleanupJobError {
  if (error instanceof ConversationDirectoryCleanupJobError) {
    return error;
  }
  return new ConversationDirectoryCleanupJobError(
    'cleanup_job_persistence_failed',
    stage,
    readStorageCode(error),
  );
}

function parseLastFailure(
  raw: string | null,
  stage: ConversationDirectoryCleanupJobFailureStage,
): unknown {
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConversationDirectoryCleanupJobError('cleanup_job_corrupt', stage);
  }
}

function mapRow(
  row: ConversationDirectoryCleanupJobRow,
  stage: ConversationDirectoryCleanupJobFailureStage,
): ConversationDirectoryCleanupJob {
  return parseStoredConversationDirectoryCleanupJob({
    jobId: row.job_id,
    conversationId: row.conversation_id,
    operation: row.operation_kind,
    requestedAt: row.requested_at,
    retryCount: row.retry_count,
    lastFailure: parseLastFailure(row.last_failure_json, stage),
  }, stage);
}

function serializeFailure(failure: ConversationDirectoryCleanupFailure): string {
  return JSON.stringify(failure);
}

export class SqliteConversationDirectoryCleanupJobPort
implements ConversationDirectoryCleanupJobPort {
  constructor(private readonly db: Database.Database) {}

  async begin(
    requested: ConversationDirectoryCleanupJob,
  ): Promise<ConversationDirectoryCleanupJobBeginResult> {
    try {
      const transaction = this.db.transaction(() => {
        // 读取与合并必须在同一事务内完成，否则并发的清理/删除请求可能丢失较强的删除意图。
        const existing = this.readStored(requested.conversationId, 'begin');
        const resolution = resolveConversationDirectoryCleanupJobBegin({
          existing,
          requested,
        });

        if (resolution.status === 'created') {
          this.db.prepare<[string, string, string, number, number, string | null]>(`
            INSERT INTO conversation_directory_cleanup_jobs (
              conversation_id,
              job_id,
              operation_kind,
              requested_at,
              retry_count,
              last_failure_json
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            resolution.job.conversationId,
            resolution.job.jobId,
            resolution.job.operation,
            resolution.job.requestedAt,
            resolution.job.retryCount,
            resolution.job.lastFailure ? serializeFailure(resolution.job.lastFailure) : null,
          );
        } else if (resolution.status === 'upgraded') {
          this.db.prepare<[string, string, string, string]>(`
            UPDATE conversation_directory_cleanup_jobs
            SET operation_kind = ?
            WHERE conversation_id = ? AND job_id = ? AND operation_kind = ?
          `).run(
            resolution.job.operation,
            resolution.job.conversationId,
            resolution.job.jobId,
            'clear_work_directory',
          );
        }

        return resolution;
      });
      return transaction();
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'begin');
    }
  }

  async read(
    conversationId: ConversationDirectoryCleanupJob['conversationId'],
  ): Promise<ConversationDirectoryCleanupJob | null> {
    try {
      return this.readStored(conversationId, 'read');
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'read');
    }
  }

  async list(): Promise<readonly ConversationDirectoryCleanupJob[]> {
    try {
      return this.db
        .prepare<[], ConversationDirectoryCleanupJobRow>(`
          SELECT
            conversation_id,
            job_id,
            operation_kind,
            requested_at,
            retry_count,
            last_failure_json
          FROM conversation_directory_cleanup_jobs
          ORDER BY requested_at ASC, conversation_id ASC
        `)
        .all()
        .map(row => mapRow(row, 'list'));
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'list');
    }
  }

  async recordFailure(input: ConversationDirectoryCleanupJobScope & {
    readonly failure: ConversationDirectoryCleanupFailure;
  }): Promise<ConversationDirectoryCleanupJob | null> {
    try {
      const transaction = this.db.transaction(() => {
        // jobId 区分同一对话的前后两代任务；operation 再隔离同一代任务升级前的旧 worker。
        const existing = this.readStored(input.conversationId, 'record_failure');
        const updated = advanceConversationDirectoryCleanupFailure({
          existing,
          scope: input,
          failure: input.failure,
        });
        if (!updated) {
          return null;
        }

        this.db.prepare<[number, string, string, string, string]>(`
          UPDATE conversation_directory_cleanup_jobs
          SET retry_count = ?, last_failure_json = ?
          WHERE conversation_id = ? AND job_id = ? AND operation_kind = ?
        `).run(
          updated.retryCount,
          serializeFailure(updated.lastFailure),
          updated.conversationId,
          updated.jobId,
          updated.operation,
        );
        return updated;
      });
      return transaction();
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'record_failure');
    }
  }

  async complete(scope: ConversationDirectoryCleanupJobScope): Promise<boolean> {
    try {
      const result = this.db.prepare<[string, string, string]>(`
        DELETE FROM conversation_directory_cleanup_jobs
        WHERE conversation_id = ? AND job_id = ? AND operation_kind = ?
      `).run(scope.conversationId, scope.jobId, scope.operation);
      return result.changes > 0;
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'complete');
    }
  }

  private readStored(
    conversationId: ConversationDirectoryCleanupJob['conversationId'],
    stage: ConversationDirectoryCleanupJobFailureStage,
  ): ConversationDirectoryCleanupJob | null {
    const row = this.db
      .prepare<[string], ConversationDirectoryCleanupJobRow>(`
        SELECT
          conversation_id,
          job_id,
          operation_kind,
          requested_at,
          retry_count,
          last_failure_json
        FROM conversation_directory_cleanup_jobs
        WHERE conversation_id = ?
        LIMIT 1
      `)
      .get(conversationId);
    return row ? mapRow(row, stage) : null;
  }
}
