/**
 * @file sandboxRuntime.ts
 * @description 后端插件访问宿主沙箱平台能力的窄门面。
 *
 * 中文说明：
 * - 沙箱 runner / 子进程生命周期仍归宿主管；
 * - 插件只能注册自己的 profile 载荷，不能直接改宿主内部 registry；
 * - 运行态启停由插件 contribution 同步器负责，直接调用这些函数时也必须显式注销。
 * - 这里保持相对导入，避免 `src/...` alias 在测试/运行时制造另一份 SandboxService 单例。
 */

import { getDefaultSandboxService } from '../../features/sandbox/sandboxCompositionRoot';
import type { SandboxProfileRegistrationOptions } from '../../features/sandbox/SandboxProfileRegistry';
import type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxJsonValue,
  SandboxProfile,
} from '../../features/sandbox/types';

export type {
  ResourceLimits,
  SandboxCapabilityGrant,
  SandboxError,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxJsonArray,
  SandboxJsonObject,
  SandboxJsonPrimitive,
  SandboxJsonValue,
  SandboxLanguage,
  SandboxCapabilityCall,
  SandboxPolicy,
  SandboxPreparedExecution,
  SandboxProfile,
  SandboxRequestTelemetry,
  SandboxRunnerRequest,
  SandboxRunnerResult,
  SandboxRunnerDiagnostics,
  SandboxProfileRegistrationOptions,
} from '@linnya/plugin-host-contract/backend/sandboxRuntime';

export function registerSandboxProfile<TValue extends SandboxJsonValue | undefined>(
  profile: SandboxProfile<TValue>,
  options?: SandboxProfileRegistrationOptions,
): void {
  getDefaultSandboxService().registerProfile(profile, options);
}

export function unregisterSandboxProfile(profileId: string): boolean {
  return getDefaultSandboxService().unregisterProfile(profileId);
}

export function hasSandboxProfile(profileId: string): boolean {
  return getDefaultSandboxService().hasProfile(profileId);
}

export function listSandboxProfileIds(): readonly string[] {
  return getDefaultSandboxService().listProfileIds();
}

export function executeSandboxProfile<TValue extends SandboxJsonValue | undefined = SandboxJsonValue | undefined>(
  request: SandboxExecutionRequest,
  options?: { readonly abortSignal?: AbortSignal },
): Promise<SandboxExecutionResult<TValue>> {
  return getDefaultSandboxService().execute<TValue>(request, options);
}
