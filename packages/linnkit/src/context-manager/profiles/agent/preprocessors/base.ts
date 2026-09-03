export interface ToolReplayProtocolPolicy {
  provider?: string;
  requiresProviderContinuationForToolReplay?: boolean;
}

declare module '../../../shared/preprocessors/base' {
  interface PreprocessorContext {
    /**
     * Agent profile 专属的 provider replay 治理策略。
     *
     * 中文说明：基类实现仍归 shared；agent 只通过类型增广补自己的上下文字段，
     * 避免为了一个 profile 字段复制整套 BasePreprocessor。
     */
    toolReplayProtocolPolicy?: ToolReplayProtocolPolicy;
  }
}

export {
  BasePreprocessor,
} from '../../../shared/preprocessors/base';

export type {
  IPreprocessor,
  PreprocessorContext,
  PreprocessorResult,
  ToolSummaryProvider,
} from '../../../shared/preprocessors/base';
