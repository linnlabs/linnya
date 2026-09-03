import {
  ConversationTerminalToolInteractionSchema,
  type ConversationInteractionResponseRequest,
  type IncrementalEvent,
} from '@app/schemas';
import { projectInteractionResponseObservation } from './projectInteractionResponseObservation';

type InteractionResponseIncomingEvent = Extract<IncrementalEvent, { type: 'tool_output' }>;

/**
 * 把一次 HITL response command 投影成 Host 唯一创建的 committed incoming fact。
 * command 的恢复身份只用于 RunSupervisor admission；terminal UI interaction 只记录展示结果。
 */
export function buildInteractionResponseIncomingEvent(params: {
  readonly response: ConversationInteractionResponseRequest;
  readonly turnId: string;
  readonly eventId: string;
  readonly timestamp: number;
}): InteractionResponseIncomingEvent {
  const interaction = ConversationTerminalToolInteractionSchema.parse({
    status: params.response.interaction_status,
    submittedAt: params.response.interaction_submitted_at,
    ...(params.response.interaction_response === undefined
      ? {}
      : { response: params.response.interaction_response }),
  });

  return {
    type: 'tool_output',
    id: params.eventId,
    timestamp: params.timestamp,
    turn_id: params.turnId,
    tool_call_id: params.response.tool_call_id,
    tool_name: params.response.tool_name,
    observation: projectInteractionResponseObservation(params.response),
    data: params.response.data,
    status: 'success',
    metadata: { interaction },
  };
}
