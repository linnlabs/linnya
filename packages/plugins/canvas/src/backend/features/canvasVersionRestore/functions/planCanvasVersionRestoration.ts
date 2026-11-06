import { CanvasElementSchema } from '../../../../shared';
import type { CanvasCommitPlan, CanvasElementChange } from '../../canvasCommit';
import type { CanvasVersionRestorationInput } from '../definitions/canvasVersionRestoration';
import {
  assertCanvasVersionRestorationClaims,
  assertCanvasVersionRestorationTarget,
  canvasVersionRestorationFields,
} from './canvasVersionRestorationRules';

/** 完整恢复直接建立最终图；不能按选择性撤回的中间状态避让即将删除的卡片。 */
export function planCanvasVersionRestoration(
  input: CanvasVersionRestorationInput
): CanvasCommitPlan {
  if (input.actor.source.kind !== 'user') throw new Error('canvas_user_transition_required');
  const target = assertCanvasVersionRestorationTarget(input.targetSnapshot);
  const targets = new Map(target.elements.map(element => [element.id, element]));
  const rows = new Map(input.state.elements.map(row => [row.element.id, row]));
  const changes: CanvasElementChange[] = [];
  let maximumRevision = input.state.maximumRevision;
  for (const id of new Set([...rows.keys(), ...targets.keys()])) {
    const current = rows.get(id);
    const element = targets.get(id);
    if (!element) {
      if (current) {
        const change = { id, before: current.element, after: null, fields: ['$existence'] };
        assertCanvasVersionRestorationClaims(change, input.claims);
        changes.push(change);
        rows.delete(id);
      }
      continue;
    }
    const fields = current
      ? canvasVersionRestorationFields(current.element, element)
      : [...Object.keys(element), '$existence'];
    if (!fields.length) continue;
    const revision = current
      ? current.element.revision + 1
      : Math.max(input.state.maximumRevision, element.revision) + 1;
    const after = CanvasElementSchema.parse({
      ...element,
      revision,
      updatedBy: input.actor.source,
      updatedAt: input.now,
    });
    const change = { id, before: current?.element ?? null, after, fields };
    assertCanvasVersionRestorationClaims(change, input.claims);
    const fieldOrigins = { ...current?.fieldOrigins },
      fieldVersions = { ...current?.fieldVersions };
    for (const field of fields) {
      fieldOrigins[field] = input.origin;
      fieldVersions[field] = revision;
    }
    rows.set(id, { element: after, fieldOrigins, fieldVersions });
    maximumRevision = Math.max(maximumRevision, revision);
    changes.push(change);
  }
  return {
    origin: input.origin,
    changes,
    refs: {},
    retainedElements: target.elements,
    results: changes.map((change, index) => ({
      id: change.id,
      index,
      status: 'applied',
      reason: null,
    })),
    // 分配计数来自当前文档，恢复旧内容不能重新发放曾用过的卡/线身份。
    state: {
      ...input.state,
      maximumRevision,
      sequence: input.state.sequence + (changes.length ? 1 : 0),
      elements: [...rows.values()],
    },
  };
}
