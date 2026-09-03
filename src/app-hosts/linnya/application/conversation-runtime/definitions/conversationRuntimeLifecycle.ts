import type { SandboxRunnerPort } from '../../../../../features/sandbox';

/** App 生命周期只取得 Profiled Code Sandbox 的收口能力，不取得 Utility 或 evaluator 身份。 */
export interface SandboxAppOwnerLifecyclePort {
  endOwnerAndWait(): Promise<void>;
}

/**
 * Conversation runtime 使用的 Sandbox 窄 scope。具体 Electron Utility 或 headless Node
 * adapter 只能实现这个合同，不能把平台进程控制泄漏给应用编排。
 */
export interface SandboxProductionScope
  extends SandboxRunnerPort, SandboxAppOwnerLifecyclePort {}
