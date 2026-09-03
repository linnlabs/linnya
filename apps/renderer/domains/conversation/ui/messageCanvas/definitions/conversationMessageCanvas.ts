import type { ComponentPublicInstance } from 'vue';
import type { ConversationVisualRow } from './conversationVisualRow';

/**
 * 消息画布只消费已经完成语义投影的 visual-row。
 * offsetPx 存在时由虚拟化 adapter 拥有几何；缺省时按普通文档流排列。
 */
export interface ConversationMessageCanvasRowPlacement {
  readonly item: ConversationVisualRow;
  readonly index: number;
  readonly offsetPx?: number;
}

/**
 * 主时间线交给消息画布的尾部状态。active 决定最后一行是否保留共享 tail region，
 * visible 只控制等待图标，不能改变 region 几何。
 */
export interface ConversationMessageCanvasTrailingStatus {
  readonly active: boolean;
  readonly visible: boolean;
}

export type ConversationVisualRowMeasureElement = (
  element: Element | ComponentPublicInstance | null,
) => void;
