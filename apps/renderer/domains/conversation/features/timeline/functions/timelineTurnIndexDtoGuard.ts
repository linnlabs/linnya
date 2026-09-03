import { isRecord } from '../../../utils/typeGuards';
import { ConversationCompleteVisualTurnIdSchema } from '@app/schemas';
import type {
  TimelineTurnIndexDto,
  TimelineTurnIndexItemDto,
} from '../definitions/timelineTurnIndex';

export function readTimelineTurnIndexDto(value: unknown): TimelineTurnIndexDto {
  if (isReadyDto(value) || isPreparingDto(value)) return value;
  throw new Error('turn index response does not match the timeline DTO contract');
}

function isReadyDto(value: unknown): value is Extract<TimelineTurnIndexDto, { success: true }> {
  return isRecord(value)
    && value.success === true
    && typeof value.conversation_id === 'string'
    && Array.isArray(value.turns)
    && value.turns.every(isTurnIndexItemDto)
    && typeof value.revision === 'number'
    && Number.isFinite(value.revision);
}

function isPreparingDto(value: unknown): value is Extract<TimelineTurnIndexDto, { success: false }> {
  return isRecord(value)
    && value.success === false
    && value.status === 'preparing'
    && typeof value.conversation_id === 'string';
}

function isTurnIndexItemDto(value: unknown): value is TimelineTurnIndexItemDto {
  return isRecord(value)
    && ConversationCompleteVisualTurnIdSchema.safeParse(value.visual_turn_id).success
    && typeof value.ordinal === 'number'
    && Number.isFinite(value.ordinal)
    && typeof value.summary === 'string'
    && typeof value.anchor_message_id === 'string'
    && typeof value.sort_seq === 'number'
    && Number.isFinite(value.sort_seq);
}
