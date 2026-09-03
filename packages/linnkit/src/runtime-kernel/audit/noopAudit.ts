import type { AuditPort } from '../../ports';

export const noopAudit: AuditPort = {
  emit(): void {
    // 审计是可选能力；默认 no-op 保持现有运行时无副作用。
  },
  flush(): void {
    // 无缓冲状态。
  },
};
