import type { CommandExecutionAuditEvent } from './commandExecutionAuditEvent';

/** 追加命令执行事实的窄端口；查询、清理和持久化技术不属于命令运行时。 */
export interface CommandExecutionAuditPort {
  record(event: CommandExecutionAuditEvent): Promise<void>;
}
