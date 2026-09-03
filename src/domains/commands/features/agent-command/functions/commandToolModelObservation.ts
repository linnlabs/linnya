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

/** 只解析永不换行的第一条控制记录；后续正文可被通用 head/tail 治理截断。 */
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
