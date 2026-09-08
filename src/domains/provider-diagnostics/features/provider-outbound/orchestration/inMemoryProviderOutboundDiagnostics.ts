import type {
  ProviderOutboundDiagnosticsPort,
  ProviderOutboundDiagnosticsSnapshotPort,
} from '../definitions/providerOutboundDiagnosticsPort';
import type { ProviderOutboundAttemptSnapshot } from '../definitions/providerOutboundAttempt';

export interface InMemoryProviderOutboundDiagnostics
  extends ProviderOutboundDiagnosticsPort,
    ProviderOutboundDiagnosticsSnapshotPort {}

export function createInMemoryProviderOutboundDiagnostics(): InMemoryProviderOutboundDiagnostics {
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
 * 它只服务即时排障，不冒充持久化 Audit。
 */
export const defaultProviderOutboundDiagnostics = createInMemoryProviderOutboundDiagnostics();
