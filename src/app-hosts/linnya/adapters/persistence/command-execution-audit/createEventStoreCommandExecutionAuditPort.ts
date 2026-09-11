import type { AuditPort } from '@linnlabs/linnkit/ports';

import {
  projectCommandExecutionAuditEnvelope,
  type CommandExecutionAuditEvent,
  type CommandExecutionAuditPort,
} from 'src/domains/audit';

export interface CreateEventStoreCommandExecutionAuditPortOptions {
  readonly auditPort: AuditPort;
}

/**
 * 复用 Linnkit AuditPort，才能继续沿用 EventStore 的隐藏 audit_envelope 合同和清理策略。
 * adapter 只校验和投影 producer 合同。可选诊断 sink 的失败由统一 AuditRuntime 处理，
 * record 完成不证明诊断已落盘，也不充当命令执行恢复的 durable barrier。
 */
export function createEventStoreCommandExecutionAuditPort(
  options: CreateEventStoreCommandExecutionAuditPortOptions,
): CommandExecutionAuditPort {
  return Object.freeze({
    async record(event: CommandExecutionAuditEvent): Promise<void> {
      const envelope = projectCommandExecutionAuditEnvelope({
        event,
      });
      await options.auditPort.emit(envelope);
    },
  });
}
