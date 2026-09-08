import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import { configureLlmRunAudit } from '../features/llm-run-audit/orchestration/llmRunAuditContext';
import { createDebugEvidenceAuditPort } from '../features/debug-evidence';
import {
  isAuditActionEnabled,
  isDebugEvidenceAction,
  type AuditLevel,
} from '../definitions/auditLevel';
import { resolveAuditLevel } from '../functions/resolveAuditLevel';

export interface LinnyaAuditRuntime {
  readonly level: AuditLevel;
  readonly auditPort: AuditPort;
  flush(): Promise<void>;
}

export interface CreateLinnyaAuditRuntimeOptions {
  /** KB 级结构化决策账本的唯一 durable sink。 */
  readonly sink: AuditPort;
  readonly level?: AuditLevel;
  /** 只有 debug 等级会使用；目录内数据由 Audit Domain 统一限额和清理。 */
  readonly debugEvidenceDirectoryPath?: string;
}

/**
 * 创建 Linnya 进程内唯一审计入口。
 *
 * 所有 durable audit、命令审计和 debug LLM evidence 都必须使用返回的 port。
 * KB 级决策写 EventStore；`llm.*` 大材料写 Audit Domain 管理的有界开发目录，
 * 避免拖慢历史分页和上下文重建。
 */
export function createLinnyaAuditRuntime(
  options: CreateLinnyaAuditRuntimeOptions
): LinnyaAuditRuntime {
  const level = options.level ?? resolveAuditLevel();
  const debugEvidencePort =
    level === 'debug' && options.debugEvidenceDirectoryPath
      ? createDebugEvidenceAuditPort({ directoryPath: options.debugEvidenceDirectoryPath })
      : undefined;
  const auditPort: AuditPort = Object.freeze({
    emit(envelope: AuditEnvelope): void | Promise<void> {
      if (!isAuditActionEnabled(level, envelope.action)) return;
      if (isDebugEvidenceAction(envelope.action)) {
        return debugEvidencePort?.emit(envelope);
      }
      return options.sink.emit(envelope);
    },
    flush: async () => {
      await options.sink.flush?.();
      await debugEvidencePort?.flush?.();
    },
  });

  configureLlmRunAudit({ auditPort, level });

  return Object.freeze({
    level,
    auditPort,
    async flush(): Promise<void> {
      await auditPort.flush?.();
    },
  });
}
