import type { AuditEnvelope } from '../contracts';

/**
 * 审计事件输出端口。
 *
 * 中文备注：
 * - emit 允许同步或异步实现；framework 调用方需要 await，避免 file sink 未写完；
 * - envelope 是追加只读事实，不提供 update/delete。
 */
export interface AuditPort {
  emit(envelope: AuditEnvelope): void | Promise<void>;
  flush?(): void | Promise<void>;
}
