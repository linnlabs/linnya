import {
  CommandAgentModelControlV1Schema,
  type CommandAgentModelControlV1,
} from '@app/schemas/commands';

export const COMMAND_MODEL_CONTROL_LINE_PREFIX = 'command_control: ';

export function formatCommandToolModelObservation(input: {
  readonly control: CommandAgentModelControlV1;
  readonly bodyLabel: 'output' | 'message';
  readonly body: string;
}): string {
  const control = CommandAgentModelControlV1Schema.parse(input.control);
  return `${COMMAND_MODEL_CONTROL_LINE_PREFIX}${JSON.stringify(control)}\n\n${input.bodyLabel}:\n${input.body}`;
}

/** 只解析 owner 原始 observation 的控制首行；通用存档预览/续读均为数据，不能穿透其不可信边界恢复控制。 */
export function parseCommandToolModelControlLine(
  observation: string,
): CommandAgentModelControlV1 {
  const firstLineEnd = observation.indexOf('\n');
  const firstLine = firstLineEnd === -1
    ? observation
    : observation.slice(0, firstLineEnd);
  if (!firstLine.startsWith(COMMAND_MODEL_CONTROL_LINE_PREFIX)) {
    throw new Error('命令工具模型观察缺少控制首行');
  }
  const encoded = firstLine.slice(COMMAND_MODEL_CONTROL_LINE_PREFIX.length);
  const parsed: unknown = JSON.parse(encoded);
  return CommandAgentModelControlV1Schema.parse(parsed);
}
