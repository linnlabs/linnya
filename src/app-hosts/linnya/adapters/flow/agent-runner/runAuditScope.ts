import { flushLinnyaAudit, runWithLLMAuditContext } from 'src/domains/audit';
import { Logger } from 'src/shared/logger';

const logger = new Logger('RunAuditScope');

export interface RunAuditScopeOptions {
  conversationId: string;
  runId: string;
  traceId: string;
  source?: string;
}

/**
 * 中文备注：
 * - 这层只负责包装 run 级别的 LLM audit 生命周期；
 * - 主执行函数只关心“在 audit scope 中运行什么”，不再自己关心 finally flush；
 * - 这样 audit 语义和业务执行语义可以分离。
 */
export async function runWithAgentAuditScope<T>(
  options: RunAuditScopeOptions,
  execute: () => Promise<T>
): Promise<T> {
  return runWithLLMAuditContext(
    {
      conversationId: options.conversationId,
      runId: options.runId,
      traceId: options.traceId,
      source: options.source ?? 'agent_run',
    },
    async () => {
      try {
        return await execute();
      } finally {
        try {
          await flushLinnyaAudit();
        } catch (error) {
          // 审计是观测能力，写盘失败必须可见，但不能覆盖业务成功或原始业务异常。
          logger.error('[RunAuditScope] 统一审计最终写入失败', {
            conversationId: options.conversationId,
            runId: options.runId,
            traceId: options.traceId,
            error,
          });
        }
      }
    }
  );
}
