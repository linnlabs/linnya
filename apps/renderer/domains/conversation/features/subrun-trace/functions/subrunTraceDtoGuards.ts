import { validateRuntimeEvent } from 'linnkit/contracts';
import type { RuntimeEvent } from 'linnkit/contracts';
import { isRecord } from '../../../utils/typeGuards';
import type { SubrunTraceDto, SubrunTracePreparingDto, SubrunTraceReadyDto } from '../definitions/subrunTrace';

export function readSubrunTraceDto(value: unknown): SubrunTraceDto {
  if (isSubrunTraceReadyDto(value)) {
    return value;
  }
  if (isSubrunTracePreparingDto(value)) {
    return value;
  }
  throw new Error('subrun-trace response does not match the DTO contract');
}

function isSubrunTracePreparingDto(value: unknown): value is SubrunTracePreparingDto {
  return isRecord(value)
    && value.success === false
    && value.status === 'preparing'
    && typeof value.conversation_id === 'string';
}

function isSubrunTraceReadyDto(value: unknown): value is SubrunTraceReadyDto {
  return isRecord(value)
    && value.success === true
    && typeof value.conversation_id === 'string'
    && typeof value.parent_tool_call_id === 'string'
    && typeof value.subrun_id === 'string'
    && Array.isArray(value.events)
    && value.events.every(isRuntimeEvent)
    && (value.next_cursor === null || (typeof value.next_cursor === 'number' && Number.isFinite(value.next_cursor)))
    && typeof value.revision === 'number'
    && Number.isFinite(value.revision);
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  return validateRuntimeEvent(value).success;
}
