import {
  COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
  type CommandProcessHandle,
  type ProcessAgentModelControlV1,
  type ProcessToolRuntimeResult,
} from '@app/schemas/commands';

import { formatCommandToolModelObservation } from './commandToolModelObservation';
import { formatCommandOutputStoreReferences } from './formatCommandOutputStoreReferences';

export function projectProcessToolModelControl(input: {
  readonly processHandle: CommandProcessHandle;
  readonly result: ProcessToolRuntimeResult;
}): ProcessAgentModelControlV1 {
  const common = {
    protocol_version: COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
    kind: 'process_model_control' as const,
    process_handle: input.processHandle,
  };
  if (input.result.status === 'running') {
    return {
      ...common,
      status: 'running',
      next_cursor: input.result.nextCursor,
    };
  }
  if (input.result.status === 'completed') {
    return {
      ...common,
      status: 'completed',
      terminal: input.result.terminal,
    };
  }
  if (input.result.status === 'accepted') {
    return { ...common, status: 'accepted' };
  }
  return {
    ...common,
    status: 'rejected',
    code: input.result.code,
  };
}

export function formatProcessToolModelObservation(input: {
  readonly processHandle: CommandProcessHandle;
  readonly result: ProcessToolRuntimeResult;
}): string {
  const references = input.result.status === 'completed'
    ? formatCommandOutputStoreReferences(input.result.command_output_store)
    : '';
  return formatCommandToolModelObservation({
    control: projectProcessToolModelControl(input),
    bodyLabel: input.result.status === 'rejected' ? 'message' : 'output',
    body: references.length > 0
      ? `${input.result.observation}\n${references}`
      : input.result.observation,
  });
}
