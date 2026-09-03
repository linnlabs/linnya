/**
 * 一次 SSE 事件写入 conversation 投影后的结果。
 *
 * 该契约由请求级 realtime-event-routing feature 与投影 store 共享，不承担事件路由职责。
 */
export interface EventDispatchResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly reason?: string;
  readonly eventSummary?: {
    readonly type: string;
    readonly conversationId: string;
    readonly eventId?: string;
    readonly turnId?: string;
    readonly answerId?: string;
    readonly toolCallId?: string;
  };
}
