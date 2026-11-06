import type { CanvasSnapshot } from '../../shared';
import { readCanvasEditingClaims } from '../features/canvasCommit';
import { resolveCanvasLayoutOptions, bindCanvasLayout } from '../features/canvasWrite';
import type { CanvasCliArrangementInput } from './definitions/canvasCliExecution';
/** 布局计算在事务外使用预演尺寸；正式提交仍复核保护与修订。 */
export async function prepareCanvasCliArrangement(input: CanvasCliArrangementInput) {
  const { request, arrangement, scope, services, document } = input;

  const preview = document.editing.preview({ request, actor: scope.actor, now: Date.now() });
  const planned: CanvasSnapshot = {
    schemaVersion: 1,
    documentId: scope.documentId,
    sequence: preview.state.sequence,
    elements: preview.state.elements.map(row => row.element),
  };
  const options = resolveCanvasLayoutOptions(arrangement, preview.refs);
  const protectedElementIds = readCanvasEditingClaims(scope.database, {
    documentId: scope.documentId,
    viewId: scope.actor.viewId,
    now: Date.now(),
  })
    .filter(claim => claim.fields.some(field => ['x', 'y', 'width', 'height'].includes(field)))
    .map(claim => claim.elementId);
  const layout = await services.capabilities.computation.layout(
    { ...options, requestId: request.requestId, snapshot: planned, protectedElementIds },
    scope.context.signal
  );
  const bound = bindCanvasLayout(layout, preview.refs, options.groups);
  return {
    request: {
      ...request,
      operations: [...request.operations, ...bound.operations],
      layoutGroups: bound.layoutGroups,
    },
    diagnostics: layout.diagnostics,
    computation: layout.computation,
  };
}
