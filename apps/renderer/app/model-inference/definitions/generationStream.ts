import type { SSEEvent } from '@linnlabs/linnkit/contracts';

export type GenerationErrorEvent = Extract<SSEEvent, { type: 'error' | 'transport_error' }>;
export type GenerationTransportEndEvent = Extract<SSEEvent, { type: 'transport_end' }>;
export type GenerationFinalAnswerEvent = Extract<SSEEvent, { type: 'final_answer' }>;

/** 一条生成流结束时决定成败的事实：首个失败事件与 Host 的收尾事件。 */
export interface GenerationStreamTerminalFacts {
  readonly firstError?: GenerationErrorEvent;
  readonly transportEnd?: GenerationTransportEndEvent;
}

export type GenerationStreamFailureCode =
  | 'run_error'
  | 'transport_end_not_complete'
  | 'unexpected_eof'
  | 'protocol';

/**
 * 生成请求在流里失败。调用方按普通 Error 处理即可；code 只用于日志区分失败来源，
 * 不能据此对模型错误做重试或改写提示。
 */
export class GenerationStreamError extends Error {
  readonly code: GenerationStreamFailureCode;
  readonly errorCode?: string;

  constructor(message: string, code: GenerationStreamFailureCode, errorCode?: string) {
    super(message);
    this.name = 'GenerationStreamError';
    this.code = code;
    this.errorCode = errorCode;
  }
}
