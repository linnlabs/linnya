import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { createEmptyCanvasDocument, readCanvasCommitState, readCanvasSnapshot } from '../persistence/canvasRepository';
import { commitCanvasOperations } from '../orchestration/commitCanvasOperations';
import { planCanvasCommit } from '../functions/planCanvasCommit';
import { planCanvasLayout } from '../../canvasLayoutRun';
import { bindCanvasLayout, resolveCanvasLayoutOptions } from '../../canvasWrite';
import {
  createCanvasPlainTextDocument,
  type CanvasCard,
  type CanvasCommand,
  type CanvasElement,
  type CanvasLayoutRequest,
  type CanvasSnapshot,
} from '../../../../shared';
import type { CanvasCommitActor } from '../definitions/canvasCommit';

const agent: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'conversation', runId: 'run' }, viewId: 'agent' };
const layered: Parameters<typeof planCanvasLayout>[1] = async cards => cards.map((card, index) => ({ id: card.id, x: index * 300, y: 0 }));
type Arrangement = Pick<CanvasLayoutRequest, 'algorithm' | 'direction' | 'columns'>;

function fixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('canvas');
  createEmptyCanvasDocument(database, 'canvas');
  return database;
}

/** 29 张卡（第一张落在空画布原点）加 7 个带成员的分区，同一批创建。 */
function seedOperations(): CanvasCommand[] {
  const cards: CanvasCommand[] = Array.from({ length: 29 }, (_, index) => ({
    op: 'addText', ref: `$card${index}`, content: createCanvasPlainTextDocument(`卡片 ${index + 1}`), width: 240, height: 98,
  }));
  const sections: CanvasCommand[] = Array.from({ length: 7 }, (_, section) => ({
    op: 'addSection', ref: `$section${section}`, title: `分区 ${section + 1}`, width: 360, height: 240,
    members: Array.from({ length: 29 }, (_, index) => index).filter(index => index % 7 === section).map(index => `$card${index}`),
  }));
  return [...cards, ...sections];
}

function expectMembersInsideSections(elements: readonly CanvasElement[]) {
  const sections = new Map(elements.flatMap(element => (element.type === 'section' ? [[element.id, element] as const] : [])));
  const members = elements.filter((element): element is CanvasCard => element.type !== 'edge' && element.type !== 'section' && element.parentId !== null);
  expect(members.length).toBeGreaterThan(0);
  for (const card of members) {
    const section = sections.get(card.parentId!);
    expect(section, card.id).toBeDefined();
    expect({ id: card.id, inside: card.x >= section!.x && card.y >= section!.y && card.x + card.width <= section!.x + section!.width && card.y + card.height <= section!.y + section!.height }).toEqual({ id: card.id, inside: true });
  }
}

const snapshotOf = (elements: readonly CanvasElement[], sequence: number): CanvasSnapshot => ({ schemaVersion: 1, documentId: 'canvas', sequence, elements: [...elements] });

describe('arranging sections created in the same batch', () => {
  it.each<Arrangement>([
    { algorithm: 'grid', direction: 'right', columns: 1 },
    { algorithm: 'layered', direction: 'right' },
  ])('keeps a member whose computed position is unchanged inside its moved section ($algorithm)', async arrangement => {
    const database = fixture();
    try {
      commitCanvasOperations({ database, actor: agent, now: 1, request: { documentId: 'canvas', requestId: 'seed', operations: seedOperations() } });
      const before = readCanvasSnapshot(database, 'canvas');
      const layout = await planCanvasLayout({ ...arrangement, requestId: 'arrange', snapshot: before }, layered);
      const bound = bindCanvasLayout(layout, {});
      commitCanvasOperations({ database, actor: agent, now: 2, request: { documentId: 'canvas', requestId: 'arrange', operations: bound.operations, layoutGroups: bound.layoutGroups } });
      expectMembersInsideSections(readCanvasSnapshot(database, 'canvas').elements);
    } finally { database.close(); }
  });

  it('moves an unchanged member with its section when an obstacle appears after the calculation', async () => {
    const database = fixture();
    try {
      commitCanvasOperations({ database, actor: agent, now: 1, request: { documentId: 'canvas', requestId: 'seed', operations: seedOperations() } });
      const before = readCanvasSnapshot(database, 'canvas');
      const layout = await planCanvasLayout({ algorithm: 'grid', direction: 'right', columns: 1, requestId: 'arrange', snapshot: before }, layered);
      const unchanged = before.elements.filter(element => element.type === 'text' && !layout.operations.some(move => move.id === element.id));
      expect(unchanged.map(element => element.id)).toContain('c1');
      const firstSection = layout.operations.find(move => before.elements.find(element => element.id === move.id)?.type === 'section');
      const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
      commitCanvasOperations({ database, actor: user, now: 2, request: { documentId: 'canvas', requestId: 'obstacle', operations: [
        { op: 'addText', content: createCanvasPlainTextDocument('后来的卡'), x: Number(firstSection?.patch.x) + 400, y: Number(firstSection?.patch.y) + 60, width: 240, height: 98 },
      ] } });
      const bound = bindCanvasLayout(layout, {});
      const result = commitCanvasOperations({ database, actor: agent, now: 3, request: { documentId: 'canvas', requestId: 'arrange', operations: bound.operations, layoutGroups: bound.layoutGroups } });
      expect(result.results.some(item => item.reason === 'placed_around_current_obstacle')).toBe(true);
      const after = readCanvasSnapshot(database, 'canvas').elements;
      expectMembersInsideSections(after);
      expect(after.find(element => element.id === 'c1')).not.toMatchObject({ x: 0, y: 0 });
    } finally { database.close(); }
  });

  it('keeps members inside their sections when the arrangement ends the creating batch', async () => {
    const database = fixture();
    try {
      const operations = seedOperations();
      const state = readCanvasCommitState(database, 'canvas');
      const preview = planCanvasCommit({ state, operations, actor: agent, origin: 'preview', claims: [], now: 1 });
      const planned = snapshotOf(preview.state.elements.map(row => row.element), preview.state.sequence);
      const options = resolveCanvasLayoutOptions({ algorithm: 'grid', direction: 'right', columns: 1 }, preview.refs);
      const layout = await planCanvasLayout({ ...options, requestId: 'apply', snapshot: planned }, layered);
      const bound = bindCanvasLayout(layout, preview.refs);
      commitCanvasOperations({ database, actor: agent, now: 1, request: { documentId: 'canvas', requestId: 'apply', operations: [...operations, ...bound.operations], layoutGroups: bound.layoutGroups } });
      expectMembersInsideSections(readCanvasSnapshot(database, 'canvas').elements);
    } finally { database.close(); }
  });
});
