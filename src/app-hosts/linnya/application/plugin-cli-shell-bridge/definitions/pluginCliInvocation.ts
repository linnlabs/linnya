import type { ModelPurposeSnapshot } from '@app/schemas';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import type { PluginInferenceOperation, PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';

import type { BackendPluginCliRegistration } from '../../../plugin-registry/registry';
import type { PluginCliBridgeFailureCode } from './pluginCliBridgeProtocol';
import type {
  PluginCliBridgeUnexpectedFailureStage,
  PluginCliConversationInputSession,
} from './pluginCliShellBridgeRuntime';

/**
 * 一次插件命令调用由谁发起、以什么权限运行。Shell 桥从父 Shell 的冻结 launch 取得，
 * plugin_cli 工具从当前 run 的权限快照取得；两条入口之后走同一份准入与执行规则。
 */
export interface PluginCliInvocationScope {
  readonly conversationId: string;
  readonly agentRunId: string;
  /** 已经过会话工作目录准入的 canonical 路径；插件只能在其中写受管产物。 */
  readonly conversationRoot: string;
  /** 调用身份前缀，用于拼出可追溯的 invocationId。 */
  readonly invocationIdPrefix: string;
  readonly permission: {
    readonly internalDataAccess: 'allowed' | 'denied';
    readonly effectiveLevel: 'read_only' | 'standard' | 'full_access';
  };
  /** 错误文案里的权限主体，例如 “this Shell execution”。 */
  readonly permissionSubject: string;
  /**
   * 是否允许插件申报模型操作。外部命令行发起的运行承诺不调用 Linnya 的模型，
   * 所以该入口传 unavailable，申报了 hostInference 的命令在执行前被拒绝。
   */
  readonly hostInference:
    | { readonly status: 'available'; readonly modelPurposeSnapshot?: ModelPurposeSnapshot }
    | { readonly status: 'unavailable'; readonly reason: string };
  /** 任一信号取消都会中止本次调用：父执行结束、客户端断开、工具调用被停止等。 */
  readonly signals: readonly AbortSignal[];
}

export type PluginCliInvocationTarget =
  | { readonly kind: 'core' }
  | { readonly kind: 'plugin'; readonly pluginId: string };

export interface PluginCliInvocationDependencies {
  readonly coreCli?: BackendPluginCliContribution;
  readonly resolveCli: (pluginId: string) => BackendPluginCliRegistration | undefined;
  readonly internalDataContext: unknown;
  readonly createInferenceSession?: (input: {
    readonly operations: readonly PluginInferenceOperation[];
    readonly signal: AbortSignal;
  }) => { readonly inference: PluginInferencePort; close(): Promise<void> };
  readonly createConversationInput?: (input: {
    readonly conversationId: string;
    readonly signal: AbortSignal;
  }) => PluginCliConversationInputSession;
  readonly readConversationProjectId?: (conversationId: string) => Promise<string | null | undefined>;
  readonly createInvocationId: () => string;
}

/** 已知业务结果：权限拒绝、插件不可用、取消、输出超限。调用方原样投影，不记为未知异常。 */
export class PluginCliBridgeFailure extends Error {
  constructor(
    readonly code: PluginCliBridgeFailureCode,
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PluginCliBridgeFailure';
  }
}

/** 未知异常带上失败阶段交给入口自己的诊断端口；正文与栈不能进入命令输出。 */
export class PluginCliInvocationUnexpectedError extends Error {
  constructor(
    readonly stage: PluginCliBridgeUnexpectedFailureStage,
    readonly invocationId: string | undefined,
    readonly pluginId: string | undefined,
    readonly causeError: unknown,
  ) {
    super('Plugin CLI invocation failed unexpectedly.');
    this.name = 'PluginCliInvocationUnexpectedError';
  }
}
