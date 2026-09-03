import type {
  ProviderOutboundAttemptSnapshot,
  ProviderOutboundInputSummary,
  ProviderOutboundOperation,
  ProviderOutboundRouteIdentity,
} from './providerOutboundAttempt';

export interface ProviderOutboundAttemptStart {
  readonly attempt_id: string;
  readonly trace_id?: string;
  readonly operation: ProviderOutboundOperation;
  readonly route: ProviderOutboundRouteIdentity;
  readonly input: ProviderOutboundInputSummary;
}

/** Provider 调用方唯一允许依赖的写入边界。 */
export interface ProviderOutboundAuditPort {
  record(snapshot: ProviderOutboundAttemptSnapshot): void;
}

/** 调试读取方只获得快照，不获得写入能力或 Provider transport。 */
export interface ProviderOutboundAuditSnapshotPort {
  readLatest(): ProviderOutboundAttemptSnapshot | null;
}
