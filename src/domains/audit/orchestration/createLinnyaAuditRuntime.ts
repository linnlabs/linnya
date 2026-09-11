import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import { configureLlmEvidence } from '../features/llm-evidence/orchestration/llmEvidenceContext';
import { isAuditActionEnabled, type AuditLevel } from '../definitions/auditLevel';
import { resolveAuditLevel, type AuditRuntimeTrust } from '../functions/resolveAuditLevel';
import { Logger } from '../../../shared/logger';

const logger = new Logger('AuditRuntime');

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
    async emit(envelope: AuditEnvelope): Promise<void> {
      if (!isAuditActionEnabled(level, envelope.action)) return;
      try {
        await options.sink.emit(envelope);
      } catch {
        // 开发诊断不能成为生产执行写入屏障；不把信封正文或 sink 异常原文再次写进日志。
        logger.warn('审计写入失败，本条诊断未保存', {
          action: envelope.action, envelopeId: envelope.envelopeId, runId: envelope.runId,
        });
      }
    },
    flush: async () => {
      if (level === 'off') return;
      try {
        await options.sink.flush?.();
      } catch {
        logger.warn('审计 flush 失败，已接收诊断可能未完整保存');
      }
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
