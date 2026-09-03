import type { InjectionKey } from 'vue';

/**
 * Conversation 宿主向高成本叶子渲染器发布的窄调度端口。
 *
 * 这里只描述真实消息列是否仍在连续改变宽度，不暴露 Sidebar、Pane 或 AppLayout
 * 等来源。这样 Markdown 可以避开布局动画提交 DOM，同时仍适用于窗口和 pane resize。
 */
export interface ConversationRenderSchedulingPort {
  readonly isContentWidthChanging: () => boolean;
}

export const CONVERSATION_RENDER_SCHEDULING_PORT_KEY:
  InjectionKey<ConversationRenderSchedulingPort> = Symbol('conversation:render-scheduling');
