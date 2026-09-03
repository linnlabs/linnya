export type ConversationDirectoryFailureCode =
  | 'invalid_conversation_identity'
  | 'work_directory_root_unavailable'
  | 'work_directory_path_occupied'
  | 'work_directory_unsafe_entry'
  | 'work_directory_still_present'
  | 'work_directory_permission_denied'
  | 'work_directory_storage_full'
  | 'work_directory_cleanup_in_progress'
  | 'work_directory_io_failed';

export type ConversationDirectoryFailureStage =
  | 'derive_identity'
  | 'check_cleanup_barrier'
  | 'resolve_path'
  | 'prepare_namespace'
  | 'inspect_directory'
  | 'read_identity_marker'
  | 'publish_identity_marker'
  | 'cleanup_identity_staging'
  | 'create_directory'
  | 'inspect_deletion_root'
  | 'measure_work_directory'
  | 'delete_work_directory'
  | 'delete_identity_metadata';

/**
 * 文件系统 errno 只保留为诊断信息；业务调用者只依赖稳定 code 和 stage，
 * 避免 Windows 与 macOS 的原生错误文字渗入领域分支。
 */
export class ConversationDirectoryError extends Error {
  constructor(
    readonly code: ConversationDirectoryFailureCode,
    readonly stage: ConversationDirectoryFailureStage,
    readonly osCode?: string,
  ) {
    super(`${code} at ${stage}`);
    this.name = 'ConversationDirectoryError';
  }
}
