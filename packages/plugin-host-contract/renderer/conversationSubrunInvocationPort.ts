import type { ConversationMessageExtension } from '@app/schemas';

/**
 * 插件声明可由 conversation 宿主启动的 subrun worker。
 *
 * 调用方只使用 worker id；promptKey 由宿主从当前激活插件的声明中解析，
 * 不进入每次调用请求。当前声明用于 single/batch subrun，workflow 工具不在本契约内。
 */
export interface ConversationSubrunWorkerContribution {
  readonly id: string;
  readonly promptKey: string;
}

export interface ConversationSubrunInvocationItem {
  readonly description: string;
  readonly prompt: string;
}

/** Subrun 与普通 AI invocation 使用同一扩展合同，禁止建立第二套插件 metadata。 */
export type ConversationSubrunMessageExtension = ConversationMessageExtension;

export interface StartConversationSubrunsRequest {
  readonly pluginId: string;
  readonly workerId: string;
  readonly prompt: string;
  readonly activityFeature: string;
  readonly subruns: readonly ConversationSubrunInvocationItem[];
  readonly messageExtension?: ConversationSubrunMessageExtension;
}

export interface ConversationSubrunRunHandle {
  readonly runId: string;
  readonly completion: Promise<void>;
  cancel(): void;
}

export interface RendererConversationSubrunInvocationPort {
  start(request: StartConversationSubrunsRequest): ConversationSubrunRunHandle;
}

export declare function startConversationSubruns(
  request: StartConversationSubrunsRequest,
): ConversationSubrunRunHandle;
