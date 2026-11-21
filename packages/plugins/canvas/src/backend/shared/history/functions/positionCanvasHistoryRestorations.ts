import {
  CanvasElementSchema,
  fitCanvasSection,
  readCanvasSectionMembers,
  type CanvasElementId,
} from '../../../../shared';
import type { CanvasElementChange, CanvasStoredElement } from '../../../features/canvasCommit';
import type { CanvasHistoryRestorationPlacementInput } from '../definitions/canvasHistoryReversal';
import { findCanvasRestorationPosition } from './findCanvasRestorationPosition';

type PlacementState = {
  readonly rows: Map<CanvasElementId, CanvasStoredElement>;
  readonly changes: CanvasElementChange[];
  readonly origin: string;
};

function moveRestoredElement(
  state: PlacementState,
  current: CanvasStoredElement,
  patch: Partial<Record<'x' | 'y' | 'width' | 'height', number>>
) {
  const fields = Object.keys(patch);
  const after = CanvasElementSchema.parse({ ...current.element, ...patch });
  const origins = { ...current.fieldOrigins },
    versions = { ...current.fieldVersions };
  for (const field of fields) {
    origins[field] = state.origin;
    versions[field] = after.revision;
  }
  state.rows.set(after.id, { element: after, fieldOrigins: origins, fieldVersions: versions });
  state.changes.push({ id: after.id, before: current.element, after, fields });
}

/**
 * 恢复的分区按撤销后的成员向外长到包住它们；成员在分区删除期间被别人挪开时，
 * 分区跟着变大，而不是让成员留在框外。
 */
function fitRestoredSections(state: PlacementState, restored: ReadonlySet<CanvasElementId>) {
  const members = readCanvasSectionMembers([...state.rows.values()].map(row => row.element));
  for (const id of restored) {
    const current = state.rows.get(id);
    const section = current?.element;
    if (!current || section?.type !== 'section') continue;
    const fitted = fitCanvasSection(section, members.get(section.id) ?? []);
    const patch = Object.fromEntries(
      (['x', 'y', 'width', 'height'] as const)
        .filter(field => fitted[field] !== section[field])
        .map(field => [field, fitted[field]])
    );
    if (Object.keys(patch).length) moveRestoredElement(state, current, patch);
  }
}

/** 事务中间态不是障碍真源：本批稍后删除/移走的卡不能把复活卡挤离原位。 */
export function positionCanvasHistoryRestorations(input: CanvasHistoryRestorationPlacementInput) {
  const state: PlacementState = {
    rows: new Map(input.rows),
    changes: [...input.changes],
    origin: input.origin,
  };
  const results = [...input.results];
  for (const [id, resultIndex] of input.restorationResults) {
    const current = state.rows.get(id);
    if (!current || current.element.type === 'edge') continue;
    // 恢复的分区跟着撤销后仍属于它的成员走，不另找空位；随后按成员撑开。
    if (
      [...state.rows.values()].some(
        ({ element }) => element.type !== 'edge' && element.parentId === id
      )
    )
      continue;
    const occupied = [...state.rows.values()].flatMap(row =>
      row.element.id === id || row.element.type === 'edge' ? [] : [row.element]
    );
    const position = findCanvasRestorationPosition(current.element, occupied);
    if (position.x === current.element.x && position.y === current.element.y) continue;
    moveRestoredElement(state, current, position);
    results[resultIndex] = { ...results[resultIndex], reason: 'restored_nearby' };
  }
  fitRestoredSections(state, new Set(input.restorationResults.keys()));
  return { rows: state.rows, changes: state.changes, results };
}
