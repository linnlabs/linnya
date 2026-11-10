import type { CanvasTraceInvocation } from '../definitions/canvasToolTrace';
import type { CanvasTraceResponse } from './admitCanvasTraceResponse';

/** check/render未携带文档身份；只能按唯一目标、唯一该kind命令和唯一该kind响应归属。 */
export function readAmbiguousCanvasResponseKinds(
  commands: readonly CanvasTraceInvocation[],
  responses: readonly CanvasTraceResponse[]
) {
  const multipleTargets = new Set(commands.map(command => command.target)).size > 1;
  const ambiguous = new Set<'check' | 'render'>();
  for (const kind of ['check', 'render'] as const) {
    if (
      multipleTargets ||
      commands.filter(command => command.kind === kind).length > 1 ||
      responses.filter(response => response.kind === kind).length > 1
    )
      ambiguous.add(kind);
  }
  return ambiguous;
}
