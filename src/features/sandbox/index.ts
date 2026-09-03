/**
 * 沙箱模块公共导出
 */
export { executeInSandbox } from './CodeSandbox.js';
export type { SandboxResult, SandboxError, SandboxOptions } from './CodeSandbox.js';
export { SandboxService, registerDefaultSandboxProfiles } from './SandboxService.js';
export {
  getDefaultSandboxService,
  installDefaultSandboxRunner,
} from './sandboxCompositionRoot.js';
export { SandboxProfileRegistry } from './SandboxProfileRegistry.js';
export type { SandboxProfileRegistrationOptions } from './SandboxProfileRegistry.js';
export type {
  SandboxCapabilityCall,
  SandboxRunnerBindingSpec,
  SandboxRunnerExecutionOptions,
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from './definitions/sandboxRunner.js';
export type { SandboxRunnerPort } from './ports/sandboxRunnerPort.js';
export type {
  ResourceLimits,
  SandboxArtifactRef,
  SandboxCapabilityGrant,
  SandboxCapabilityName,
  SandboxErrorType,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxJsonArray,
  SandboxJsonObject,
  SandboxJsonPrimitive,
  SandboxJsonValue,
  SandboxLanguage,
  SandboxPolicy,
  SandboxPreparedExecution,
  SandboxProfile,
  SandboxRequestTelemetry,
  SandboxResultTelemetry,
  SandboxRunnerDiagnostics,
  SandboxUsage,
} from './types.js';
