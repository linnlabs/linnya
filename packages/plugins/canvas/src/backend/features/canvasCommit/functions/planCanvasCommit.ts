import type { CanvasElementId } from '../../../../shared';
import type { CanvasCommand } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasCommitActor, CanvasCommitPlan, CanvasCommitState, CanvasEditingClaim } from '../definitions/canvasCommit';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import type { CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import { resolveCanvasPlanElement } from './canvasPlanChanges';
import { createCanvasCard, connectCanvasCards } from './createCanvasElements';
import { mutateCanvasElement } from './mutateCanvasElement';
import { validateCanvasGraph } from './validateCanvasGraph';
import { clearCanvasLayoutObstacles } from './clearCanvasLayoutObstacles';

export function planCanvasCommit(input: {
  readonly state: CanvasCommitState; readonly operations: readonly CanvasCommand[];
  readonly actor: CanvasCommitActor; readonly origin: string; readonly claims: readonly CanvasEditingClaim[]; readonly now: number; readonly reservedRectangles?: readonly CanvasRectangle[]; readonly layoutGroups?: readonly (readonly string[])[];
}): CanvasCommitPlan {
  const plan: CanvasWorkingPlan = { layoutTargets: new Set(input.layoutGroups?.flat()), reservedRectangles: input.reservedRectangles ?? [], origin: input.origin, elements: new Map(input.state.elements.map(row => [row.element.id, row])), changes: [], results: [], refs: {},
    nextCard: input.state.nextCard, nextEdge: input.state.nextEdge, actor: input.actor, claims: input.claims, now: input.now };
  for (const command of input.operations) {
    if (command.op === 'update' || command.op === 'delete') plan.results.push(mutateCanvasElement(plan, command));
    else {
      const id = command.op === 'connect' ? connectCanvasCards(plan, command) : createCanvasCard(plan, command);
      plan.results.push({ index: plan.results.length, status: 'applied', id, reason: null });
    }
  }
  validateCanvasGraph([...plan.elements.values()].map(row => row.element));
  const result: CanvasCommitPlan = { origin: input.origin, changes: plan.changes, results: plan.results, refs: plan.refs,
    state: { ...input.state, sequence: input.state.sequence + (plan.changes.length > 0 ? 1 : 0), nextCard: plan.nextCard, nextEdge: plan.nextEdge, elements: [...plan.elements.values()], deletedOrigins: input.state.deletedOrigins } };
  const groups = input.layoutGroups?.map(group => group.flatMap(id => { const resolved = resolveCanvasPlanElement(plan, id); return resolved ? [resolved] : []; }));
  const moved = new Set<CanvasElementId>(plan.results.flatMap((outcome, index) => {
    const operation = input.operations[index];
    return outcome.status === 'applied' && outcome.id && operation.op === 'update' && (plan.layoutTargets.has(operation.id) || plan.layoutTargets.has(outcome.id)) && ('x' in operation.patch || 'y' in operation.patch) ? [outcome.id] : [];
  }));
  return groups?.length ? clearCanvasLayoutObstacles(result, groups, plan.reservedRectangles, moved) : result;
}
