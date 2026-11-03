import type { AuditPort } from '@linnlabs/linnkit/ports';
import type { AuditLevel } from './auditLevel';

export interface AuditRuntimeTrust {
  /** packaged 由已验证的 Host bootstrap facts 提供，不能由用户环境变量伪造。 */
  readonly packaged?: boolean;
}

export interface AuditLevelState {
  readonly level: AuditLevel;
  setLevel(level: AuditLevel): void;
}

export interface AuditControlPort {
  readonly available: boolean;
  readonly level: AuditLevel;
  setLevel(level: AuditLevel): void;
}

export interface LinnyaAuditRuntime extends AuditControlPort {
  readonly auditPort: AuditPort;
  levelForRun(runId: string): Promise<AuditLevel>;
  flush(): Promise<void>;
}

export interface CreateLinnyaAuditRuntimeOptions {
  readonly sink: AuditPort;
  readonly level?: AuditLevel;
  readonly trust?: AuditRuntimeTrust;
  /** Host 读取已接纳 run 的冻结档位；审计域不依赖 RunRegistry 或 SQLite。 */
  readonly readRunLevel: (runId: string) => Promise<AuditLevel>;
}

export class AuditUnavailableError extends Error {
  constructor() {
    super('生产环境不提供审计');
  }
}
