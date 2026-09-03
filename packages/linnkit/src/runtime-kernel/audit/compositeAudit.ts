import type { AuditEnvelope } from '../../contracts';
import type { AuditPort } from '../../ports';

export interface CompositeAuditOptions {
  ports: readonly AuditPort[];
}

/**
 * 组合多个审计 sink。
 *
 * 中文备注：
 * - 按顺序 await，确保 EventStore 这类主审计落点先完成；
 * - 不吞异常，审计失败应该暴露给调用方，由 host 决定是否降级。
 */
export class CompositeAuditPort implements AuditPort {
  private readonly ports: readonly AuditPort[];

  constructor(options: CompositeAuditOptions) {
    this.ports = options.ports;
  }

  async emit(envelope: AuditEnvelope): Promise<void> {
    for (const port of this.ports) {
      await port.emit(envelope);
    }
  }

  async flush(): Promise<void> {
    for (const port of this.ports) {
      await port.flush?.();
    }
  }
}

export function createCompositeAudit(options: CompositeAuditOptions): AuditPort {
  return new CompositeAuditPort(options);
}
