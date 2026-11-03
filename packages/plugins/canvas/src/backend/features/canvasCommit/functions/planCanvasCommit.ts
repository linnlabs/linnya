import { generateKeyBetween } from 'fractional-indexing';
import {
  CanvasCardIdSchema, CanvasEdgeIdSchema, CanvasElementSchema,
  type CanvasElement, type CanvasElementId, type CanvasEndpoint,
} from '../../../../shared';
import type { CanvasCommand, CanvasOperationResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasCommitActor, CanvasCommitPlan, CanvasCommitState, CanvasEditingClaim, CanvasElementChange, CanvasStoredElement } from '../definitions/canvasCommit';
import type { CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import { findCanvasPlacement } from './findCanvasPlacement';
import { validateCanvasGraph } from './validateCanvasGraph';

interface WorkingPlan {
  origin: string;
  reservedRectangles: readonly CanvasRectangle[];
  elements: Map<CanvasElementId, CanvasStoredElement>;
  changes: CanvasElementChange[];
  results: CanvasOperationResult[];
  refs: Record<string, CanvasElementId>;
  nextCard: number;
  nextEdge: number;
  actor: CanvasCommitActor;
  claims: readonly CanvasEditingClaim[];
  now: number;
}

function resolveElementId(plan: WorkingPlan, id: string): CanvasElementId | undefined {
  if (id.startsWith('$')) return plan.refs[id];
  for (const key of plan.elements.keys()) if (key === id) return key;
  return undefined;
}

function appendChange(plan: WorkingPlan, before: CanvasElement | null, after: CanvasElement | null, fields: readonly string[]): void {
  const id = after?.id ?? before?.id;
  if (!id) throw new Error('空变更没有元素身份');
  plan.changes.push({ id, before, after, fields });
  if (after) {
    const versions = { ...plan.elements.get(id)?.fieldVersions };
    const origins = { ...plan.elements.get(id)?.fieldOrigins };
    for (const field of fields) { versions[field] = after.revision; origins[field] = plan.origin; }
    if (!before) { versions.$existence = after.revision; origins.$existence = plan.origin; }
    plan.elements.set(id, { element: after, fieldVersions: versions, fieldOrigins: origins });
  } else plan.elements.delete(id);
}

function createCard(plan: WorkingPlan, command: Extract<CanvasCommand, { op: 'addText' | 'addImage' | 'addDocument' }>): CanvasElementId {
  if (command.ref && plan.refs[command.ref]) throw new Error(`临时引用重复：${command.ref}`);
  if (plan.actor.source.kind === 'agent' && (command.x !== undefined || command.y !== undefined)) {
    throw new Error('Agent 不能指定坐标，请使用 near/side');
  }
  const nearId = command.near ? resolveElementId(plan, command.near) : undefined;
  const near = nearId ? plan.elements.get(nearId)?.element : undefined;
  if (command.near && (!near || near.type === 'edge')) throw new Error(`放置目标不存在：${command.near}`);
  const cards = [...plan.elements.values()].flatMap(row => row.element.type === 'edge' ? [] : [row.element]);
  const position = plan.actor.source.kind === 'user' && command.x !== undefined && command.y !== undefined
    ? { x: command.x, y: command.y }
    : findCanvasPlacement({ width: command.width, height: command.height, near: near?.type === 'edge' ? undefined : near, side: command.side ?? 'right', occupied: [...cards, ...plan.reservedRectangles] });
  const orders = [...plan.elements.values()].map(row => row.element.order).sort();
  const lastOrder = orders[orders.length - 1] ?? null;
  const data = command.op === 'addText' ? { contentVersion: 1, content: command.content, heightMode: command.heightMode ?? 'auto' } : command.data;
  const element = CanvasElementSchema.parse({
    id: `c${plan.nextCard++}`, type: command.op === 'addText' ? 'text' : command.op === 'addImage' ? 'image' : 'document',
    schemaVersion: 1, revision: 1, order: generateKeyBetween(lastOrder, null), locked: command.locked ?? false,
    color: command.color ?? 'white', createdBy: plan.actor.source, updatedBy: plan.actor.source,
    createdAt: plan.now, updatedAt: plan.now, ...position,
    width: command.width, height: command.height,
    parentId: command.parentId ? CanvasCardIdSchema.parse(resolveElementId(plan, command.parentId)) : null, data,
  });
  appendChange(plan, null, element, Object.keys(element));
  if (command.ref) plan.refs[command.ref] = element.id;
  return element.id;
}

function connectCards(plan: WorkingPlan, command: Extract<CanvasCommand, { op: 'connect' }>): CanvasElementId {
  const endpoint = (value: string | CanvasEndpoint): CanvasEndpoint => {
    if (typeof value === 'string') return { kind: 'card', cardId: CanvasCardIdSchema.parse(resolveElementId(plan, value)), side: 'auto' };
    if (value.kind === 'point' && plan.actor.source.kind === 'agent') throw new Error('Agent 不能指定悬空坐标，请连到卡片');
    return value;
  };
  const id = CanvasEdgeIdSchema.parse(`e${plan.nextEdge++}`);
  const edge = CanvasElementSchema.parse({
    id, type: 'edge', schemaVersion: 1, revision: 1, order: generateKeyBetween(null, null),
    locked: command.locked ?? false, color: command.color ?? 'white', createdBy: plan.actor.source, updatedBy: plan.actor.source,
    createdAt: plan.now, updatedAt: plan.now,
    from: typeof command.from === 'string' ? { ...endpoint(command.from), side: command.fromSide ?? 'auto' } : endpoint(command.from),
    to: typeof command.to === 'string' ? { ...endpoint(command.to), side: command.toSide ?? 'auto' } : endpoint(command.to),
    direction: command.direction, lineStyle: command.lineStyle, linePattern: command.linePattern, label: command.label,
  });
  appendChange(plan, null, edge, Object.keys(edge));
  if (command.ref) {
    if (plan.refs[command.ref]) throw new Error(`临时引用重复：${command.ref}`);
    plan.refs[command.ref] = id;
  }
  return id;
}

function mutateElement(plan: WorkingPlan, command: Extract<CanvasCommand, { op: 'update' | 'delete' }>): CanvasOperationResult {
  const id = resolveElementId(plan, command.id);
  const row = id ? plan.elements.get(id) : undefined;
  const skip = (reason: string): CanvasOperationResult => ({ index: plan.results.length, id: id ?? null, status: 'skipped', reason });
  if (!id || !row) return skip('element_missing');
  const current = row.element;
  if (plan.actor.source.kind === 'agent' && current.locked) return skip('element_locked');
  const fields = command.op === 'update' ? Object.keys(command.patch) : ['$existence'];
  const protectedFields = plan.claims.filter(claim => claim.elementId === id).flatMap(claim => claim.fields);
  if (plan.actor.source.kind === 'agent' && (command.op === 'delete' ? protectedFields.length > 0 : fields.some(field => protectedFields.includes(field)))) {
    return skip('user_editing');
  }
  if (command.op === 'update') {
    // 文字按其字段版本判断；同卡颜色或位置改变不应把独立正文误判为冲突。
    if (fields.some(field => (row.fieldVersions[field] ?? 0) > command.baseRevision)) return skip('stale_field');
    const after = CanvasElementSchema.parse({ ...current, ...command.patch,
      revision: current.revision + 1, updatedBy: plan.actor.source, updatedAt: plan.now });
    appendChange(plan, current, after, fields);
  } else {
    if (command.baseRevision !== undefined && command.baseRevision !== current.revision) return skip('stale_element');
    appendChange(plan, current, null, fields);
    if (current.type !== 'edge') {
      const attached = [...plan.elements.values()].filter(row => row.element.type === 'edge'
        && ((row.element.from.kind === 'card' && row.element.from.cardId === id)
          || (row.element.to.kind === 'card' && row.element.to.cardId === id)));
      for (const edge of attached) appendChange(plan, edge.element, null, ['$existence']);
    }
  }
  return { index: plan.results.length, id, status: 'applied', reason: null };
}

export function planCanvasCommit(input: {
  readonly state: CanvasCommitState; readonly operations: readonly CanvasCommand[];
  readonly actor: CanvasCommitActor; readonly origin: string; readonly claims: readonly CanvasEditingClaim[]; readonly now: number; readonly reservedRectangles?: readonly CanvasRectangle[];
}): CanvasCommitPlan {
  const plan: WorkingPlan = { reservedRectangles: input.reservedRectangles ?? [], origin: input.origin, elements: new Map(input.state.elements.map(row => [row.element.id, row])), changes: [], results: [], refs: {},
    nextCard: input.state.nextCard, nextEdge: input.state.nextEdge, actor: input.actor, claims: input.claims, now: input.now };
  for (const command of input.operations) {
    if (command.op === 'update' || command.op === 'delete') plan.results.push(mutateElement(plan, command));
    else {
      const id = command.op === 'connect' ? connectCards(plan, command) : createCard(plan, command);
      plan.results.push({ index: plan.results.length, status: 'applied', id, reason: null });
    }
  }
  validateCanvasGraph([...plan.elements.values()].map(row => row.element));
  return { origin: input.origin, changes: plan.changes, results: plan.results, refs: plan.refs,
    state: { sequence: input.state.sequence + (plan.changes.length > 0 ? 1 : 0), nextCard: plan.nextCard, nextEdge: plan.nextEdge, elements: [...plan.elements.values()], deletedOrigins: input.state.deletedOrigins } };
}
