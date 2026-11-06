import type { CanvasElementId } from '../../../../shared';
import type { CanvasCommand } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasCommitActor, CanvasCommitPlan, CanvasCommitState, CanvasEditingClaim } from '../definitions/canvasCommit';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import type { CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import { resolveCanvasPlanElement } from './canvasPlanChanges';
import { createCanvasCard, connectCanvasCards } from './createCanvasElements';
import { mutateCanvasElement } from './mutateCanvasElement';
import { validateCanvasCommandContent } from './validateCanvasContent';
import { validateCanvasGraph } from './validateCanvasGraph';
import { clearCanvasLayoutObstacles } from './clearCanvasLayoutObstacles';

export function planCanvasCommit(input: {
  readonly state: CanvasCommitState; readonly operations: readonly CanvasCommand[];
  readonly actor: CanvasCommitActor; readonly origin: string; readonly claims: readonly CanvasEditingClaim[]; readonly now: number; readonly reservedRectangles?: readonly CanvasRectangle[]; readonly layoutGroups?: readonly (readonly string[])[];
}): CanvasCommitPlan {
  const plan: CanvasWorkingPlan = { layoutTargets: new Set(input.layoutGroups?.flat()), reservedRectangles: input.reservedRectangles ?? [], origin: input.origin, elements: new Map(input.state.elements.map(row => [row.element.id, row])), changes: [], results: [], refs: {},
    nextCard: input.state.nextCard, nextEdge: input.state.nextEdge, actor: input.actor, claims: input.claims, now: input.now };
  for (const command of input.operations) {
    validateCanvasCommandContent(command);
    if (command.op === 'update' || command.op === 'delete') plan.results.push(mutateCanvasElement(plan, command));
    else if (command.op === 'connect') plan.results.push(connectCanvasCards(plan, command));
    else {
      const id = createCanvasCard(plan, command);
      plan.results.push({ index: plan.results.length, status: 'applied', id, reason: null, fieldResults: [{ field: '$existence', status: 'applied', reason: null }] });
    }
  }
  validateCanvasGraph([...plan.elements.values()].map(row => row.element));
  const result: CanvasCommitPlan = { origin: input.origin, changes: plan.changes, results: plan.results, refs: plan.refs,
    state: { ...input.state, sequence: input.state.sequence + (plan.changes.length > 0 ? 1 : 0), nextCard: plan.nextCard, nextEdge: plan.nextEdge, elements: [...plan.elements.values()], deletedOrigins: input.state.deletedOrigins } };
  const groups = input.layoutGroups?.map(group => group.flatMap(id => { const resolved = resolveCanvasPlanElement(plan, id); return resolved ? [resolved] : []; }));
  const layoutIds = new Set(groups?.flat() ?? []);
  // 只有实际接纳的位置变化才参加清障，不能因同条color成功而绕过被保护的XY。
  const moved = new Set<CanvasElementId>(plan.changes.filter(change =>
    change.before !== null && layoutIds.has(change.id) && change.fields.some(field => field === 'x' || field === 'y')
  ).map(change => change.id));
  return groups?.length ? clearCanvasLayoutObstacles(result, groups, plan.reservedRectangles, moved) : result;
}
