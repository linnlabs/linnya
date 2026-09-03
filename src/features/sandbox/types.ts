export type SandboxJsonPrimitive = string | number | boolean | null;
export type SandboxJsonValue = SandboxJsonPrimitive | SandboxJsonObject | SandboxJsonArray;
export type SandboxJsonObject = { [key: string]: SandboxJsonValue };
export type SandboxJsonArray = SandboxJsonValue[];

export type SandboxLanguage = 'javascript' | 'typescript';
export type SandboxExecutionMode = 'sync' | 'async';
export type SandboxCapabilityName = string;

export type SandboxErrorType =
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'security'
  | 'compile'
  | 'policy_denied'
  | 'resource_exhausted'
  | 'transport';

export interface SandboxArtifactRef {
  artifactId: string;
  kind: string;
  label: string;
  sizeBytes: number;
  metadata?: SandboxJsonObject;
}

export interface ResourceLimits {
  timeoutMs?: number;
  maxLogLines?: number;
  maxLogLineLength?: number;
  maxResultBytes?: number;
  maxSourceBytes?: number;
  maxCapabilityPayloadBytes?: number;
  maxHeapMb?: number;
  idleTimeoutMs?: number;
}

export interface SandboxCapabilityGrant {
  name: SandboxCapabilityName;
  maxCalls?: number;
  maxBytes?: number;
  timeoutMs?: number;
  allowHosts?: string[];
  allowReadPaths?: string[];
  allowWritePaths?: string[];
}

export interface SandboxRequestTelemetry {
  conversationId?: string;
  turnId?: string;
  parentToolCallId?: string;
  metadata?: SandboxJsonObject;
}

export interface SandboxExecutionRequest {
  profileId: string;
  language: SandboxLanguage;
  source: string;
  mode?: SandboxExecutionMode;
  profileMode?: string;
  inputs?: SandboxJsonObject;
  limits?: ResourceLimits;
  capabilities?: SandboxCapabilityGrant[];
  telemetry?: SandboxRequestTelemetry;
}

export interface SandboxError {
  type: SandboxErrorType;
  message: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface SandboxUsage {
  elapsedMs: number;
  logLines: number;
  logBytes: number;
  resultBytes: number;
  capabilityCallCount: number;
  capabilityCallsByName: Record<string, number>;
  deniedActions: string[];
}

export interface SandboxRunnerDiagnostics {
  runnerKind: string;
  childPid?: number;
  startConfirmed: boolean;
  heartbeatCount: number;
  protocolEvents: string[];
  lastEvent?: string;
  stderrBytes: number;
  idleTimeoutTriggered: boolean;
  /** failed 表示本轮存在未解决的资源收口事实；succeeded 不构成额外的平台安全证明。 */
  cleanupStatus: 'succeeded' | 'failed';
}

export interface SandboxResultTelemetry {
  runId: string;
  profileId: string;
  policyVersion: string;
  limits: Required<ResourceLimits>;
  diagnostics: SandboxRunnerDiagnostics;
}

export interface SandboxExecutionResult<TValue extends SandboxJsonValue | undefined = SandboxJsonValue | undefined> {
  success: boolean;
  value?: TValue;
  logs: string[];
  error?: SandboxError;
  /** 非致命警告，例如 capability 调用成功但后续代码出错时的运行时错误信息 */
  warnings?: string[];
  usage: SandboxUsage;
  telemetry: SandboxResultTelemetry;
  artifacts: SandboxArtifactRef[];
}

export interface SandboxPolicy {
  profileId: string;
  policyVersion: string;
  limits: Required<ResourceLimits>;
  capabilities: SandboxCapabilityGrant[];
}

export interface SandboxPreparedExecution {
  runnerRequest: import('./definitions/sandboxRunner.js').SandboxRunnerRequest;
}

export interface SandboxProfile<TValue extends SandboxJsonValue | undefined = SandboxJsonValue | undefined> {
  id: string;
  policyVersion: string;
  allowedCapabilities: ReadonlySet<string>;
  buildPolicy(request: SandboxExecutionRequest): SandboxPolicy;
  prepareExecution(
    request: SandboxExecutionRequest,
    policy: SandboxPolicy,
    runId: string,
  ): SandboxPreparedExecution | SandboxExecutionResult<TValue>;
  finalizeExecution(
    request: SandboxExecutionRequest,
    policy: SandboxPolicy,
    runId: string,
    runnerResult: import('./definitions/sandboxRunner.js').SandboxRunnerResult,
  ): SandboxExecutionResult<TValue>;
}

export function isSandboxJsonValue(value: unknown): value is SandboxJsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isSandboxJsonValue(item));
  }
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((entry) => isSandboxJsonValue(entry));
}

export function isSandboxJsonObject(value: unknown): value is SandboxJsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value) && isSandboxJsonValue(value);
}

export function mergeResourceLimits(
  base: Required<ResourceLimits>,
  override?: ResourceLimits,
): Required<ResourceLimits> {
  return {
    timeoutMs: override?.timeoutMs ?? base.timeoutMs,
    maxLogLines: override?.maxLogLines ?? base.maxLogLines,
    maxLogLineLength: override?.maxLogLineLength ?? base.maxLogLineLength,
    maxResultBytes: override?.maxResultBytes ?? base.maxResultBytes,
    maxSourceBytes: override?.maxSourceBytes ?? base.maxSourceBytes,
    maxCapabilityPayloadBytes: override?.maxCapabilityPayloadBytes ?? base.maxCapabilityPayloadBytes,
    maxHeapMb: override?.maxHeapMb ?? base.maxHeapMb,
    idleTimeoutMs: override?.idleTimeoutMs ?? base.idleTimeoutMs,
  };
}
