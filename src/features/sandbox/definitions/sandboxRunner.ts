import type {
  ResourceLimits,
  SandboxCapabilityGrant,
  SandboxError,
  SandboxJsonObject,
  SandboxJsonValue,
  SandboxLanguage,
  SandboxRequestTelemetry,
  SandboxRunnerDiagnostics,
} from '../types.js';

export interface SandboxRunnerBindingSpec {
  kind: 'capability';
  globalName: string;
  capability: string;
}

export interface SandboxRunnerRequest {
  runId: string;
  profileId: string;
  language: SandboxLanguage;
  source: string;
  globals: SandboxJsonObject;
  bindings: SandboxRunnerBindingSpec[];
  limits: Required<ResourceLimits>;
  capabilities: SandboxCapabilityGrant[];
  telemetry?: SandboxRequestTelemetry;
}

export interface SandboxCapabilityCall {
  name: string;
  payload?: SandboxJsonValue;
}

export interface SandboxRunnerResult {
  success: boolean;
  value?: SandboxJsonValue;
  logs: string[];
  error?: SandboxError;
  elapsedMs: number;
  capabilityCalls: SandboxCapabilityCall[];
  deniedActions: string[];
  stderr: string;
  diagnostics: SandboxRunnerDiagnostics;
}

export interface SandboxRunnerExecutionOptions {
  readonly abortSignal?: AbortSignal;
}
