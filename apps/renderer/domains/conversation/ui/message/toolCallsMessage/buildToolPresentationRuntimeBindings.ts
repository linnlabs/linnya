import type { ToolUiConfig } from '../../tools/types';
import type { ToolUiImageAttachmentRef } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { HistoricalSubrunTraceLazySource } from '../../../features/subrun-trace';

export interface ToolPresentationRuntimeBindings {
  readonly conversationId?: string;
  readonly parentToolCallId?: string;
  readonly subrunTrace?: unknown;
  readonly subrunTraceVersion?: number;
  readonly lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
  readonly attachments?: readonly ToolUiImageAttachmentRef[];
}

/** 已迁移卡片只获得 registry 明确声明的 Host 事实。 */
export function buildToolPresentationRuntimeBindings(input: {
  readonly capabilities: ToolUiConfig['runtime'] | undefined;
  readonly conversationId: string;
  readonly parentToolCallId: string;
  readonly subrunTrace: unknown;
  readonly subrunTraceVersion: number;
  readonly historicalSubrunTraceSource: HistoricalSubrunTraceLazySource | undefined;
  readonly attachments?: readonly ToolUiImageAttachmentRef[];
}): ToolPresentationRuntimeBindings {
  return {
    ...(input.capabilities?.subrunTrace === true
      ? {
        parentToolCallId: input.parentToolCallId,
        subrunTrace: input.subrunTrace,
        subrunTraceVersion: input.subrunTraceVersion,
        lazySubrunTraceSource: input.historicalSubrunTraceSource,
      }
      : {}),
    ...(input.capabilities?.conversationId === true
      ? { conversationId: input.conversationId }
      : {}),
    ...(input.capabilities?.attachments === true && input.attachments?.length
      ? { attachments: [...input.attachments] }
      : {}),
  };
}
