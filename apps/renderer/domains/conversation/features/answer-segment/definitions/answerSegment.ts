/** 单个 answer_id 内的流式正文归并状态。 */
export interface AnswerSegmentState {
  readonly answerId: string;
  readonly chunks: Map<number, string>;
  nextSeqToAppend: number;
  maxSeqSeen: number;
  content: string;
  isComplete: boolean;
}
