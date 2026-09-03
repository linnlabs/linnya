import type {
  CommandExecutionAuditEvent,
  CommandExecutionAuditPort,
} from '../../../../../domains/audit/features/command-execution-audit';

export interface DrainableCommandExecutionAuditPort extends CommandExecutionAuditPort {
  /** 等待调用前已经进入端口的写入全部结算；失败仍由原 record 调用方处理。 */
  drain(): Promise<void>;
}

/**
 * 后台命令可能在 Shell 工具返回后才形成终态。这里仅跟踪已有 Promise，确保关闭数据库前
 * 它们已结算；不串行化、不重试，也不保存第二份审计事实。
 */
export function createDrainableCommandExecutionAuditPort(
  target: CommandExecutionAuditPort,
): DrainableCommandExecutionAuditPort {
  const pending = new Set<Promise<void>>();

  return Object.freeze({
    record(event: CommandExecutionAuditEvent): Promise<void> {
      const operation = target.record(event);
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    },

    async drain(): Promise<void> {
      while (pending.size > 0) {
        await Promise.allSettled(Array.from(pending));
      }
    },
  });
}
