import type { ConversationWorkDirectoryIdentity } from './conversationWorkDirectory';

export type ConversationWorkDirectoryUsageState =
  | 'not_created'
  | 'previous_files_unavailable'
  | 'available';

/**
 * byteSize 是活跃目录的一次非事务逻辑大小快照，不冒充文件系统实际分配的磁盘块。
 * 扫描不会主动递归观察到的符号链接或 junction；它不是路径访问控制或删除安全边界。
 */
export interface ConversationWorkDirectoryUsage {
  readonly identity: ConversationWorkDirectoryIdentity;
  readonly state: ConversationWorkDirectoryUsageState;
  readonly byteSize: number;
  readonly fileCount: number;
}
