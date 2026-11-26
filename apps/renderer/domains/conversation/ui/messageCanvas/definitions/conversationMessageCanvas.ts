import type { ComponentPublicInstance } from 'vue';
import type { ConversationVisualRow } from './conversationVisualRow';
import type { RunStatusRowView } from '../../../shared/execution-presentation';

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
 * 主时间线交给最后一行的常驻状态行（图标 · 在做什么 · 已用时长）。没有运行时为 null，
 * tail region 不为它保留位置；有运行时整轮常驻，文字变化不改变 region 几何。
 */
export type ConversationMessageCanvasTrailingStatus = RunStatusRowView;

export type ConversationVisualRowMeasureElement = (
  element: Element | ComponentPublicInstance | null,
) => void;
