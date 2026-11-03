import { CanvasTextCardSchema, type CanvasCommand, type CanvasElement } from '../../../../shared';

export function readCanvasUpdateMeasurement(current: CanvasElement, command: Extract<CanvasCommand, { op: 'update' }>) {
  if (current.type !== 'text' || current.data.heightMode !== 'auto' || (command.patch.data === undefined && command.patch.width === undefined)) return undefined;
  const data = CanvasTextCardSchema.shape.data.parse(command.patch.data ?? current.data);
  return { content: data.content, width: command.patch.width ?? current.width };
}
