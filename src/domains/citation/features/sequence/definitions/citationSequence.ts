/** 同一 turn 内，当前工具调用之前已经产生的引用数量。 */
export interface CitationSequence {
  readonly offset: number;
}

/** Citation domain 计算顺序所需的最小事件合同。 */
export interface CitationSequenceEvent {
  readonly type: string;
  readonly turn_id: string;
  readonly data?: unknown;
}
