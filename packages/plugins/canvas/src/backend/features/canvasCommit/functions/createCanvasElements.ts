import { generateKeyBetween } from 'fractional-indexing';
import {
  canvasSectionContentBounds,
  CanvasCardIdSchema,
  CanvasEdgeIdSchema,
  CanvasElementSchema,
  type CanvasCard,
  type CanvasElementId,
  type CanvasEndpoint,
  type CanvasSectionCard,
} from '../../../../shared';
import type { CanvasCommand } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { findCanvasPlacement } from './findCanvasPlacement';
import { placeCanvasCardInSection } from './placeCanvasCardInSection';
import { amendCanvasPlanElement } from './fitCanvasPlanSections';
import { appendCanvasPlanChange, resolveCanvasPlanElement } from './canvasPlanChanges';
import type { CanvasOperationResult } from '../../../../shared';
import { CanvasCommitFailure } from '../definitions/canvasCommitFailure';

type CardCommand = Extract<
  CanvasCommand,
  { op: 'addText' | 'addImage' | 'addDocument' | 'addSection' }
>;

function resolveSection(plan: CanvasWorkingPlan, command: CardCommand): CanvasSectionCard | null {
  if (!command.parentId) return null;
  const id = resolveCanvasPlanElement(plan, command.parentId),
    parent = id ? plan.elements.get(id)?.element : undefined;
  if (!parent) throw new CanvasCommitFailure('canvas_group_parent_missing');
  if (parent.type !== 'section' || command.op === 'addSection')
    throw new CanvasCommitFailure('canvas_section_parent_invalid');
  return parent;
}

/** 归入新分区的卡：锁定的不动它的归属，分区不能再进分区。 */
function resolveMembers(plan: CanvasWorkingPlan, ids: readonly string[]): CanvasCard[] {
  return ids.flatMap(value => {
    const id = resolveCanvasPlanElement(plan, value),
      card = id ? plan.elements.get(id)?.element : undefined;
    if (!card || card.type === 'edge')
      throw new CanvasCommitFailure('canvas_placement_target_missing');
    if (card.type === 'section') throw new CanvasCommitFailure('canvas_section_parent_invalid');
    return card.locked ? [] : [card];
  });
}

function resolveNear(plan: CanvasWorkingPlan, command: CardCommand): CanvasCard | undefined {
  if (!command.near) return undefined;
  const id = resolveCanvasPlanElement(plan, command.near),
    near = id ? plan.elements.get(id)?.element : undefined;
  if (!near || near.type === 'edge')
    throw new CanvasCommitFailure('canvas_placement_target_missing');
  return near;
}

function cardPosition(plan: CanvasWorkingPlan, command: CardCommand) {
  const agent = plan.actor.source.kind === 'agent';
  if (agent && (command.x !== undefined || command.y !== undefined))
    throw new CanvasCommitFailure('canvas_agent_coordinates');
  const near = resolveNear(plan, command);
  if (!agent && command.x !== undefined && command.y !== undefined)
    return { x: command.x, y: command.y };
  const section = resolveSection(plan, command);
  if (section && !near) return placeCanvasCardInSection(plan, command, section);
  const occupied = [...plan.elements.values()].flatMap(row =>
    row.element.type === 'edge' || row.element.id === section?.id ? [] : [row.element]
  );
  return findCanvasPlacement({
    width: command.width,
    height: command.height,
    near,
    side: command.side ?? 'right',
    occupied: [...occupied, ...plan.reservedRectangles],
  });
}

const cardTypes = {
  addText: 'text',
  addImage: 'image',
  addDocument: 'document',
  addSection: 'section',
} as const;
function cardData(command: CardCommand) {
  if (command.op === 'addText')
    return {
      contentVersion: 1,
      content: command.content,
      heightMode: command.heightMode ?? 'auto',
    };
  return command.op === 'addSection' ? { title: command.title } : command.data;
}
/** 带成员新建的分区围着成员建，不另找空位；其余按放置规则找位置。 */
function cardFrame(plan: CanvasWorkingPlan, command: CardCommand, members: readonly CanvasCard[]) {
  const around = canvasSectionContentBounds(members);
  return around ?? { ...cardPosition(plan, command), width: command.width, height: command.height };
}

export function createCanvasCard(plan: CanvasWorkingPlan, command: CardCommand): CanvasElementId {
  if (command.ref && plan.refs[command.ref]) throw new CanvasCommitFailure('canvas_duplicate_ref');
  const section = resolveSection(plan, command);
  const members = command.op === 'addSection' ? resolveMembers(plan, command.members ?? []) : [];
  const frame = cardFrame(plan, command, members);
  const element = CanvasElementSchema.parse({
    id: `c${plan.nextCard++}`,
    type: cardTypes[command.op],
    schemaVersion: 1,
    revision: 1,
    order: generateKeyBetween(plan.lastOrder, null),
    locked: command.locked ?? false,
    color: command.color ?? 'white',
    createdBy: plan.actor.source,
    updatedBy: plan.actor.source,
    createdAt: plan.now,
    updatedAt: plan.now,
    ...frame,
    parentId: section ? CanvasCardIdSchema.parse(section.id) : null,
    ...(command.tags?.length ? { tags: [...new Set(command.tags)] } : {}),
    ...(command.status ? { status: command.status } : {}),
    data: cardData(command),
  });
  appendCanvasPlanChange(plan, null, element, Object.keys(element));
  if (command.ref) plan.refs[command.ref] = element.id;
  for (const member of members)
    amendCanvasPlanElement(plan, member.id, { parentId: element.id }, ['parentId']);
  return element.id;
}

export function connectCanvasCards(
  plan: CanvasWorkingPlan,
  command: Extract<CanvasCommand, { op: 'connect' }>
): CanvasOperationResult {
  if (command.ref && plan.refs[command.ref]) throw new CanvasCommitFailure('canvas_duplicate_ref');
  const endpoint = (value: string | CanvasEndpoint): CanvasEndpoint => {
    if (typeof value === 'string') {
      const id = resolveCanvasPlanElement(plan, value);
      if (!id || !plan.elements.has(id) || plan.elements.get(id)?.element.type === 'edge')
        throw new CanvasCommitFailure('canvas_endpoint_missing');
      return { kind: 'card', cardId: CanvasCardIdSchema.parse(id), side: 'auto' };
    }
    if (value.kind === 'point' && plan.actor.source.kind === 'agent')
      throw new CanvasCommitFailure('canvas_agent_coordinates');
    return value;
  };
  const from =
    typeof command.from === 'string'
      ? { ...endpoint(command.from), side: command.fromSide ?? 'auto' }
      : endpoint(command.from);
  const to =
    typeof command.to === 'string'
      ? { ...endpoint(command.to), side: command.toSide ?? 'auto' }
      : endpoint(command.to);
  if (from.kind === 'card' && to.kind === 'card') {
    if (from.cardId === to.cardId) throw new CanvasCommitFailure('canvas_self_connection');
    const existing = [...plan.elements.values()].find(
      ({ element }) =>
        element.type === 'edge' &&
        element.from.kind === 'card' &&
        element.from.cardId === from.cardId &&
        element.to.kind === 'card' &&
        element.to.cardId === to.cardId
    )?.element;
    // 同方向重复创建只跳过本条；ref仍解析到原线，后续显式update可修改它。
    if (existing) {
      if (command.ref) plan.refs[command.ref] = existing.id;
      return {
        index: plan.results.length,
        status: 'skipped',
        id: existing.id,
        reason: 'connection_exists',
        fieldResults: [{ field: '$existence', status: 'skipped', reason: 'connection_exists' }],
      };
    }
  }
  const id = CanvasEdgeIdSchema.parse(`e${plan.nextEdge++}`);
  const edge = CanvasElementSchema.parse({
    id,
    type: 'edge',
    schemaVersion: 1,
    revision: 1,
    order: generateKeyBetween(plan.lastOrder, null),
    locked: command.locked ?? false,
    color: command.color ?? 'white',
    createdBy: plan.actor.source,
    updatedBy: plan.actor.source,
    createdAt: plan.now,
    updatedAt: plan.now,
    from,
    to,
    direction: command.direction,
    lineStyle: command.lineStyle,
    linePattern: command.linePattern,
    label: command.label,
  });
  appendCanvasPlanChange(plan, null, edge, Object.keys(edge));
  if (command.ref) {
    plan.refs[command.ref] = id;
  }
  return {
    index: plan.results.length,
    status: 'applied',
    id,
    reason: null,
    fieldResults: [{ field: '$existence', status: 'applied', reason: null }],
  };
}
