import type { ConversationCompleteVisualTurnId } from '@app/schemas';

export interface TimelineTurnIndexItemDto {
  readonly visual_turn_id: ConversationCompleteVisualTurnId;
  readonly ordinal: number;
  readonly summary: string;
  readonly anchor_message_id: string;
  readonly sort_seq: number;
}

export interface TimelineTurnIndexReadyDto {
  readonly success: true;
  readonly conversation_id: string;
  readonly turns: readonly TimelineTurnIndexItemDto[];
  readonly revision: number;
}

export interface TimelineTurnIndexPreparingDto {
  readonly success: false;
  readonly status: 'preparing';
  readonly conversation_id: string;
}

export type TimelineTurnIndexDto = TimelineTurnIndexReadyDto | TimelineTurnIndexPreparingDto;

export type TimelineTurnIndexLoadStatus = 'idle' | 'loading' | 'preparing' | 'ready' | 'error';

export interface TimelineTurnIndexApiPort {
  readTurnIndex(conversationId: string): Promise<TimelineTurnIndexDto>;
}
