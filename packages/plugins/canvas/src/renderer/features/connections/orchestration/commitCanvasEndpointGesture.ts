import type { CanvasEndpointCommitInput } from '../definitions/canvasConnections';
import type { CanvasCommitResult, CanvasEndpoint } from '@plugin/canvas/shared';

/** 松手只提交一次；新线指向空白时继续走本地新卡草稿，不提前建立持久对象。 */
export function commitCanvasEndpointGesture(
  input: CanvasEndpointCommitInput
): Promise<CanvasCommitResult> | Promise<void> {
  const { session, gesture, target, point, createText } = input;
  if (gesture.edge)
    return session.commit([
      {
        op: 'update',
        id: gesture.edge.id,
        baseRevision: gesture.edge.revision,
        patch: { [gesture.field]: target },
      },
    ]);
  if (target.kind === 'point') return createText(point, gesture.from);
  const from: CanvasEndpoint =
    gesture.from.kind === 'card' ? { ...gesture.from, side: 'auto' } : gesture.from;
  return session.commit([
    {
      op: 'connect',
      from,
      to: target,
      direction: 'forward',
      label: '',
      lineStyle: 'curve',
      linePattern: 'solid',
    },
  ]);
}
