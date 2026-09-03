import {
  COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
  type ShellAgentModelControlV1,
  type ShellToolRuntimeResult,
} from '@app/schemas/commands';

import { formatCommandToolModelObservation } from './commandToolModelObservation';
import { formatCommandOutputStoreReferences } from './formatCommandOutputStoreReferences';

export function projectShellToolModelControl(
  result: ShellToolRuntimeResult,
): ShellAgentModelControlV1 {
  if (result.status === 'running') {
    return {
      protocol_version: COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
      kind: 'shell_model_control',
      status: 'running',
      process_handle: result.processHandle,
      next_cursor: result.nextCursor,
    };
  }
  if (result.status === 'completed') {
    return {
      protocol_version: COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
      kind: 'shell_model_control',
      status: 'completed',
      terminal: result.terminal,
    };
  }
  return {
    protocol_version: COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION,
    kind: 'shell_model_control',
    status: 'rejected',
    code: result.code,
  };
}

export function formatShellToolModelObservation(result: ShellToolRuntimeResult): string {
  const references = result.status === 'completed'
    ? formatCommandOutputStoreReferences(result.command_output_store)
    : '';
  return formatCommandToolModelObservation({
    control: projectShellToolModelControl(result),
    bodyLabel: result.status === 'rejected' ? 'message' : 'output',
    body: references.length > 0 ? `${result.observation}\n${references}` : result.observation,
  });
}
