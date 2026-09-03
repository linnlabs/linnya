import type {
  SandboxRunnerExecutionOptions,
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from '../definitions/sandboxRunner.js';

/**
 * Sandbox 业务层只依赖这条窄边界，不感知本地进程、IPC 或平台进程所有权。
 * 这样后续替换底层运行时不会改动 profile 和插件的业务协议。
 */
export interface SandboxRunnerPort {
  execute(
    request: SandboxRunnerRequest,
    options?: SandboxRunnerExecutionOptions,
  ): Promise<SandboxRunnerResult>;
}
