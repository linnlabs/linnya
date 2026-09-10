import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import { configureLlmEvidence } from '../features/llm-evidence/orchestration/llmEvidenceContext';
import { isAuditActionEnabled, type AuditLevel } from '../definitions/auditLevel';
import { resolveAuditLevel, type AuditRuntimeTrust } from '../functions/resolveAuditLevel';

export interface LinnyaAuditRuntime {
  readonly level: AuditLevel;
  readonly auditPort: AuditPort;
  flush(): Promise<void>;
}

export interface CreateLinnyaAuditRuntimeOptions {
  /** KB 级结构化决策账本的唯一 durable sink。 */
  readonly sink: AuditPort;
  readonly level?: AuditLevel;
  /** 由 Host bootstrap 提供的运行身份；packaged 环境强制关闭开发审计。 */
  readonly trust?: AuditRuntimeTrust;
}

/**
 * 创建 Linnya 进程内唯一审计入口。
 *
 * 所有 durable Agent Run Audit、命令审计和 LLM stream evidence 都必须使用返回的 port。
 * 不再根据 action 把正式审计分流到文件；高体积证据的上限由 LLM evidence feature
 * 负责，最终仍进入当前 Workspace 的数据库 sink。
 */
export function createLinnyaAuditRuntime(
  options: CreateLinnyaAuditRuntimeOptions
): LinnyaAuditRuntime {
  const requestedLevel = options.level ?? resolveAuditLevel(process.env, options.trust);
  const level = options.trust?.packaged === true ? 'off' : requestedLevel;
  const auditPort: AuditPort = Object.freeze({
    emit(envelope: AuditEnvelope): void | Promise<void> {
      if (!isAuditActionEnabled(level, envelope.action)) return;
      return options.sink.emit(envelope);
    },
    flush: async () => {
      await options.sink.flush?.();
    },
  });

  configureLlmEvidence({ auditPort, level });

  return Object.freeze({
    level,
    auditPort,
    async flush(): Promise<void> {
      await auditPort.flush?.();
    },
  });
}
