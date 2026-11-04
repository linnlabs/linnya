import { generateKeyBetween } from 'fractional-indexing';
import { CanvasCardIdSchema, CanvasEdgeIdSchema, CanvasElementSchema, type CanvasElementId, type CanvasEndpoint } from '../../../../shared';
import type { CanvasCommand } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { findCanvasPlacement } from './findCanvasPlacement';
import { appendCanvasPlanChange, resolveCanvasPlanElement } from './canvasPlanChanges';

type CardCommand = Extract<CanvasCommand, { op: 'addText' | 'addImage' | 'addDocument' }>;

function cardPosition(plan: CanvasWorkingPlan, command: CardCommand) {
  if (plan.actor.source.kind === 'agent' && (command.x !== undefined || command.y !== undefined)) {
    throw new Error('Agent 不能指定坐标，请使用 near/side');
  }
  const nearId = command.near ? resolveCanvasPlanElement(plan, command.near) : undefined;
  const near = nearId ? plan.elements.get(nearId)?.element : undefined;
  if (command.near && (!near || near.type === 'edge')) throw new Error(`放置目标不存在：${command.near}`);
  const cards = [...plan.elements.values()].flatMap(row => row.element.type === 'edge' ? [] : [row.element]);
  return plan.actor.source.kind === 'user' && command.x !== undefined && command.y !== undefined
    ? { x: command.x, y: command.y }
    : findCanvasPlacement({ width: command.width, height: command.height, near: near?.type === 'edge' ? undefined : near, side: command.side ?? 'right', occupied: [...cards, ...plan.reservedRectangles] });
}

export function createCanvasCard(plan: CanvasWorkingPlan, command: CardCommand): CanvasElementId {
  if (command.ref && plan.refs[command.ref]) throw new Error(`临时引用重复：${command.ref}`);
  const position = cardPosition(plan, command);
  const orders = [...plan.elements.values()].map(row => row.element.order).sort();
  const lastOrder = orders[orders.length - 1] ?? null;
  const data = command.op === 'addText' ? { contentVersion: 1, content: command.content, heightMode: command.heightMode ?? 'auto' } : command.data;
  const element = CanvasElementSchema.parse({
    id: `c${plan.nextCard++}`, type: command.op === 'addText' ? 'text' : command.op === 'addImage' ? 'image' : 'document',
    schemaVersion: 1, revision: 1, order: generateKeyBetween(lastOrder, null), locked: command.locked ?? false,
    color: command.color ?? 'white', createdBy: plan.actor.source, updatedBy: plan.actor.source,
    createdAt: plan.now, updatedAt: plan.now, ...position,
    width: command.width, height: command.height,
    parentId: command.parentId ? CanvasCardIdSchema.parse(resolveCanvasPlanElement(plan, command.parentId)) : null, data,
  });
  appendCanvasPlanChange(plan, null, element, Object.keys(element));
  if (command.ref) plan.refs[command.ref] = element.id;
  return element.id;
}

export function connectCanvasCards(plan: CanvasWorkingPlan, command: Extract<CanvasCommand, { op: 'connect' }>): CanvasElementId {
  const endpoint = (value: string | CanvasEndpoint): CanvasEndpoint => {
    if (typeof value === 'string') return { kind: 'card', cardId: CanvasCardIdSchema.parse(resolveCanvasPlanElement(plan, value)), side: 'auto' };
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
  appendCanvasPlanChange(plan, null, edge, Object.keys(edge));
  if (command.ref) {
    if (plan.refs[command.ref]) throw new Error(`临时引用重复：${command.ref}`);
    plan.refs[command.ref] = id;
  }
  return id;
}
