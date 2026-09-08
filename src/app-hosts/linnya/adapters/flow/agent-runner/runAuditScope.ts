import { flushLinnyaAudit, runWithLLMDebugEvidenceContext } from 'src/domains/audit';
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
 * - 这层负责建立 run 级统一审计范围，并在 debug 等级下附加 LLM evidence context；
 * - 主执行函数只关心“在审计范围中运行什么”，不再自己处理 finally flush；
 * - Audit Domain 决定 evidence 的存储方式，runner 不持有路径和保留策略。
 */
export async function runWithAgentAuditScope<T>(
  options: RunAuditScopeOptions,
  execute: () => Promise<T>
): Promise<T> {
  return runWithLLMDebugEvidenceContext(
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
