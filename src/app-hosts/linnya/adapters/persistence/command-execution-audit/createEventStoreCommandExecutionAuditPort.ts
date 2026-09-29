import type { AuditPort } from '@linnlabs/linnkit/ports';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import {
  projectCommandExecutionAuditEnvelope,
  type CommandExecutionAuditEvent,
  type CommandExecutionAuditPort,
} from 'src/domains/audit';

export interface CreateEventStoreCommandExecutionAuditPortOptions {
  readonly auditPort: AuditPort;
  readonly runs: Pick<runSupervisor.RunSupervisor, 'peek'>;
}

/**
 * 复用 Linnkit AuditPort，才能继续沿用 EventStore 的隐藏 audit_envelope 合同和清理策略。
 * adapter 校验 producer 合同并从正式 run registry 补足路由身份。可选诊断 sink 的失败由统一 AuditRuntime 处理，
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
      // terminal 可能在调用上下文退出、取消或重启后到达，必须按 execution 的 run 查询持久身份。
      const owner = await options.runs.peek(envelope.runId);
      if (!owner || owner.conversationId !== envelope.scope?.conversationId) {
        throw new Error('Command audit requires a registered run in the same conversation');
      }
      await options.auditPort.emit({ ...envelope, parentRunId: owner.parentRunId });
    },
  });
}
