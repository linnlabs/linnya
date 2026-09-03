import type { ConversationMessageExtension } from '@app/schemas';

export type PluginPromptKey = string;

export interface RendererAiDocumentMetadata {
  readonly id?: string;
  readonly title?: string;
}

/** 插件输入扩展直接复用产品边界合同，禁止在 plugin-host 重列字段。 */
export type RendererConversationMessageExtension = ConversationMessageExtension;

export interface RendererAiHistoryIsolatedRunRequest {
  readonly prompt: string;
  readonly promptKey: PluginPromptKey;
  readonly activityFeature: string;
  readonly contextBefore?: string;
  readonly documentFragment?: string | null;
  readonly documentMetadata?: RendererAiDocumentMetadata;
  readonly messageExtension?: RendererConversationMessageExtension;
  readonly missingProjectMessage?: string;
}

export interface RendererAiInvocationFence {
  readonly kind: string;
  readonly content: string;
  readonly attrs?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface RendererAiInvocationUserQuoteItem {
  /** composer 创建并贯穿请求、持久化与回放的正式引用身份。 */
  readonly id: string;
  readonly pluginId: string;
  readonly kind: string;
  readonly uri?: string;
  readonly text: string;
  readonly label?: string;
  readonly source?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface RendererAiInvocationUserQuote {
  readonly items: readonly RendererAiInvocationUserQuoteItem[];
}

export interface RendererAiInvocationConversation {
  readonly conversationId: string;
}

export interface RendererEnsureAiConversationRequest {
  readonly agentChoiceId?: string;
}

export interface RendererSendAiMessageRequest {
  readonly conversationId: string;
  readonly prompt: string;
  readonly promptKey?: PluginPromptKey;
  readonly enableTools?: boolean;
  readonly fences?: readonly RendererAiInvocationFence[];
  readonly userQuote?: RendererAiInvocationUserQuote;
}

export interface RendererAiInvocationPort {
  readonly id: string;
  readonly startHistoryIsolatedRun: (request: RendererAiHistoryIsolatedRunRequest) => Promise<void>;
  readonly ensureConversation: (
    request: RendererEnsureAiConversationRequest,
  ) => Promise<RendererAiInvocationConversation | null>;
  readonly sendMessage: (request: RendererSendAiMessageRequest) => Promise<boolean>;
  readonly reportError: (message: string) => void;
}

export declare function registerRendererAiInvocationPort(port: RendererAiInvocationPort): void;
export declare function getRendererAiInvocationPort(): RendererAiInvocationPort | undefined;
export declare function requireRendererAiInvocationPort(): RendererAiInvocationPort;
