/**
 * Job 行存在本身就是持久 cleanup barrier，完成后物理删除，不另建状态机。
 * conversation_id 故意不设外键：删除对话事实后，job 仍须存活到文件与元数据收尾完成。
 */
export const CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA: string[] = [
  `
  CREATE TABLE IF NOT EXISTS conversation_directory_cleanup_jobs (
    conversation_id   TEXT    PRIMARY KEY,
    job_id            TEXT    NOT NULL UNIQUE,
    operation_kind    TEXT    NOT NULL
      CHECK(operation_kind IN ('clear_work_directory', 'delete_conversation')),
    requested_at      INTEGER NOT NULL CHECK(requested_at >= 0),
    retry_count       INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
    last_failure_json TEXT
  );
  `,
];
