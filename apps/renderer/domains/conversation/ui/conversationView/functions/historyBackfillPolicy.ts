import type { MessageWindowLoadMode, MessageWindowStatus } from '../../../message-window';
import type { ConversationScrollMode } from './scrollPositionController';

export interface HistoryBackfillTriggerInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
  readonly scrollMode: ConversationScrollMode;
  readonly hasMoreBefore: boolean;
  readonly windowStatus: MessageWindowStatus;
  readonly loadingMode: MessageWindowLoadMode | null;
  readonly isNavigating: boolean;
}

export interface HistoryForwardFillTriggerInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
  readonly scrollMode: ConversationScrollMode;
  readonly hasMoreAfter: boolean;
  readonly windowStatus: MessageWindowStatus;
  readonly loadingMode: MessageWindowLoadMode | null;
  readonly isNavigating: boolean;
}

function calculateHistoryWindowTriggerThreshold(
  viewportHeight: number,
  scrollHeight: number,
): number {
  return Math.max(viewportHeight * 2, scrollHeight / 4);
}

function canLoadWindowPage(input: {
  readonly windowStatus: MessageWindowStatus;
  readonly loadingMode: MessageWindowLoadMode | null;
  readonly isNavigating: boolean;
}): boolean {
  return input.windowStatus === 'ready'
    && input.loadingMode === null
    && !input.isNavigating;
}

export function shouldTriggerLoadBefore(input: HistoryBackfillTriggerInput): boolean {
  return input.scrollTop < calculateHistoryWindowTriggerThreshold(input.viewportHeight, input.scrollHeight)
    && input.hasMoreBefore
    && input.scrollMode !== 'follow-bottom'
    && canLoadWindowPage(input);
}

export function shouldTriggerLoadAfter(input: HistoryForwardFillTriggerInput): boolean {
  const distanceFromBottom = Math.max(input.scrollHeight - input.scrollTop - input.viewportHeight, 0);
  return distanceFromBottom < calculateHistoryWindowTriggerThreshold(input.viewportHeight, input.scrollHeight)
    && input.hasMoreAfter
    && canLoadWindowPage(input);
}
