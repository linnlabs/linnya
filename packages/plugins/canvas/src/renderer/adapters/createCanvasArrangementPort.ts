import { CanvasArrangeRequestSchema, CanvasArrangeResultSchema, CanvasCancelArrangementRequestSchema } from '@plugin/canvas/shared';
import type { CanvasArrangementPort } from '../features/layoutCommands';
import { requestCanvasIpc, requestCanvasMutation } from './requestCanvasIpc';
export function createCanvasArrangementPort(): CanvasArrangementPort {
  return {
    arrange: input => requestCanvasMutation('canvas:arrange', CanvasArrangeRequestSchema.parse(input), value => CanvasArrangeResultSchema.parse(value)),
    async cancel(input) { await requestCanvasIpc('canvas:cancel-arrange', CanvasCancelArrangementRequestSchema.parse(input)); },
  };
}
