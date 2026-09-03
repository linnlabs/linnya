export type ConversationScrollMode = 'follow-bottom' | 'anchored' | 'free';

export interface ConversationScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export function readBottomDistance(metrics: ConversationScrollMetrics): number {
  return Math.max(metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop, 0);
}
