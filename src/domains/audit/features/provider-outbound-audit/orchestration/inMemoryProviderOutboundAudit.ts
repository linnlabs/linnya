import type {
  ProviderOutboundAuditPort,
  ProviderOutboundAuditSnapshotPort,
} from '../definitions/providerOutboundAuditPort';
import type { ProviderOutboundAttemptSnapshot } from '../definitions/providerOutboundAttempt';

export interface InMemoryProviderOutboundAudit
  extends ProviderOutboundAuditPort,
    ProviderOutboundAuditSnapshotPort {}

export function createInMemoryProviderOutboundAudit(): InMemoryProviderOutboundAudit {
  let latest: ProviderOutboundAttemptSnapshot | null = null;

  return {
    record(snapshot) {
      if (snapshot.status === 'started' || latest?.attempt_id === snapshot.attempt_id) {
        latest = structuredClone(snapshot);
      }
    },
    readLatest() {
      return latest === null ? null : structuredClone(latest);
    },
  };
}

/**
 * 当前进程的统一安全快照。Electron 主进程、worker 与测试进程各自隔离；
 * 它只服务即时排障，不冒充持久化 run audit。
 */
export const defaultProviderOutboundAudit = createInMemoryProviderOutboundAudit();
