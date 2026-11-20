import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { canvasSectionContentBounds, createCanvasPlainTextDocument, type CanvasCard, type CanvasElement } from '../../../../shared';

function fixture() {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const user = { source: { kind: 'user' as const, conversationId: null, runId: null }, viewId: 'view' };
  const commit = (operations: unknown[]) => history.commit({ request: { documentId: 'doc', requestId: String(next++), operations }, actor: user, now: next });
  const undo = (direction: 'undo' | 'redo' = 'undo') => history.undo({ documentId: 'doc', viewId: 'view', requestId: String(next++), direction }, next);
  const commitFromOtherView = (operations: unknown[]) => history.commit({ request: { documentId: 'doc', requestId: String(next++), operations }, actor: { ...user, viewId: 'other' }, now: next });
  return { database, commit, commitFromOtherView, undo, get elements() { return readCanvasSnapshot(database, 'doc').elements; } };
}
const text = (label: string, x: number, y: number) => ({ op: 'addText', content: createCanvasPlainTextDocument(label), x, y, width: 240, height: 120 });
const byId = (elements: readonly CanvasElement[], id: string) => elements.find(element => element.id === id);
const cards = (elements: readonly CanvasElement[], ids: readonly string[]) => elements.filter((element): element is CanvasCard => ids.includes(element.id) && element.type !== 'edge');

/** “放进新分区”与界面提交一致：分区框围着成员，成员在同一批改归属。 */
function groupIntoSection(f: ReturnType<typeof fixture>, ids: readonly string[]) {
  const frame = canvasSectionContentBounds(cards(f.elements, ids));
  return f.commit([{ op: 'addSection', ref: '$section', title: '', ...frame, members: ids }]).refs.$section;
}
function expectInside(section: CanvasElement | undefined, members: readonly CanvasCard[]) {
  expect(section?.type).toBe('section');
  if (!section || section.type === 'edge') return;
  for (const card of members) {
    expect(card.parentId).toBe(section.id);
    expect(card.x >= section.x && card.y >= section.y && card.x + card.width <= section.x + section.width && card.y + card.height <= section.y + section.height, card.id).toBe(true);
  }
}

describe('Canvas section undo', () => {
  it('removes the new section when grouping into a new section is undone', () => {
    const f = fixture();
    f.commit([text('A', 0, 0), text('B', 300, 0)]);
    const section = groupIntoSection(f, ['c1', 'c2']);
    expect(byId(f.elements, section)).toBeDefined();
    f.undo();
    expect(byId(f.elements, section)).toBeUndefined();
    expect(cards(f.elements, ['c1', 'c2']).map(card => card.parentId)).toEqual([null, null]);
    f.undo('redo');
    expectInside(byId(f.elements, section), cards(f.elements, ['c1', 'c2']));
    f.database.close();
  });

  it('keeps the new section when another source later puts a card into it', () => {
    const f = fixture();
    f.commit([text('A', 0, 0), text('B', 300, 0), text('C', 2000, 0)]);
    const section = groupIntoSection(f, ['c1', 'c2']);
    f.commitFromOtherView([{ op: 'update', id: 'c3', baseRevision: 1, patch: { parentId: section } }]);
    f.undo();
    expect(byId(f.elements, section)).toBeDefined();
    expect(byId(f.elements, 'c3')).toMatchObject({ parentId: section });
    f.database.close();
  });

  it('restores a deleted section around its members instead of pushing it away', () => {
    const f = fixture();
    f.commit([text('A', 0, 0), text('B', 300, 0)]);
    const section = groupIntoSection(f, ['c1', 'c2']);
    const before = byId(f.elements, section);
    f.commit([{ op: 'delete', id: section }]);
    expect(cards(f.elements, ['c1', 'c2']).map(card => card.parentId)).toEqual([null, null]);
    f.undo();
    const restored = byId(f.elements, section);
    expect(restored).toMatchObject({ x: before?.x, y: before?.y });
    expectInside(restored, cards(f.elements, ['c1', 'c2']));
    f.database.close();
  });

  it('grows a restored section around members that moved while it was deleted', () => {
    const f = fixture();
    f.commit([text('A', 0, 0), text('B', 300, 0)]);
    const section = groupIntoSection(f, ['c1', 'c2']);
    f.commit([{ op: 'delete', id: section }]);
    const moved = byId(f.elements, 'c2');
    f.commitFromOtherView([{ op: 'update', id: 'c2', baseRevision: moved?.revision ?? 0, patch: { x: 900, y: 400 } }]);
    f.undo();
    expect(byId(f.elements, 'c2')).toMatchObject({ x: 900, y: 400 });
    expectInside(byId(f.elements, section), cards(f.elements, ['c1', 'c2']));
    f.database.close();
  });
});
