import type { BaseMessage } from '../../../types';

/** 执行通知的窄展示合同；不向 legacy types 入口新增公共符号。 */
export type ExecutionNoticeMessage = Extract<BaseMessage, { type: 'execution_notice' }>;
