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
 * adapter 不吞写入错误：调用方必须知道审计事实没有落盘，不能把失败伪装成成功。
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
