import type { InjectionKey } from 'vue';

/**
 * 一次 ConversationView 挂载所拥有的不可变会话身份。
 *
 * 参考 `docs/conversation-platform/08-lifecycle.md` 与
 * `packages/linnkit/docs/integration/realtime.md`：异步卡片必须继续使用消息窗口所属身份，
 * 禁止在展开或请求返回时重新读取可能已经切换的 active conversation。
 */
export interface ConversationRenderScope {
  readonly conversationId: string;
}

export const CONVERSATION_RENDER_SCOPE_KEY: InjectionKey<ConversationRenderScope> =
  Symbol('conversation:render-scope');
