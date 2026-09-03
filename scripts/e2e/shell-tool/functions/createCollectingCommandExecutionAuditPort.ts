import type {
  CommandExecutionAuditEvent,
  CommandExecutionAuditPort,
} from '../../../../src/domains/audit/features/command-execution-audit';

export interface CollectingCommandExecutionAuditPort extends CommandExecutionAuditPort {
  read(): readonly CommandExecutionAuditEvent[];
}

/** 正式进程 fixture 显式收集审计事实，避免测试组合根通过隐式空实现绕过生产依赖。 */
export function createCollectingCommandExecutionAuditPort(): CollectingCommandExecutionAuditPort {
  const events: CommandExecutionAuditEvent[] = [];
  return Object.freeze({
    async record(event: CommandExecutionAuditEvent): Promise<void> {
      events.push(event);
    },
    read(): readonly CommandExecutionAuditEvent[] {
      return events;
    },
  });
}
